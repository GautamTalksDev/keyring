import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

import type { Database } from "../db/client.js";
import {
  appendChainedAudit,
  getApprovalCard,
  getScanRun,
  listAuditChain,
  listAuditRecords,
  listCardsForScan,
  resetDemoScan,
  setCardDecision,
  verifyStoredAuditChain,
} from "../db/store.js";
import { contentHash, scanBus, scanLog, signExport } from "./progress.js";
import {
  auditExportQuerySchema,
  auditQuerySchema,
  cardDecisionBodySchema,
  cardIdParamSchema,
  createScanBodySchema,
  executeScanBodySchema,
  scanIdParamSchema,
} from "./schemas.js";
import { executeApprovedCards } from "../services/execute.js";
import { getScanCosts, startScan } from "../services/scan-runner.js";
import type { ApprovalStatus, Decision } from "@keyring/core";
import { listRecordings } from "../recording/store.js";

function zodError(reply: FastifyReply, err: ZodError) {
  return reply.code(400).send({
    error: "validation_error",
    details: err.flatten(),
  });
}

function initSse(reply: FastifyReply): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
}

function writeSse(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function registerApiRoutes(app: FastifyInstance, opts: { db: Database["db"] }): void {
  const { db } = opts;

  app.post("/scans", async (req, reply) => {
    let body;
    try {
      body = createScanBodySchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) return zodError(reply, err);
      throw err;
    }

    const result = await startScan(db, body, req.log);
    req.log.info({ scanId: result.scanId }, "scan accepted");
    return reply.code(202).send(result);
  });

  app.get("/scans/:id", async (req, reply) => {
    let params;
    try {
      params = scanIdParamSchema.parse(req.params);
    } catch (err) {
      if (err instanceof ZodError) return zodError(reply, err);
      throw err;
    }
    const scan = await getScanRun(db, params.id);
    if (!scan) {
      return reply.code(404).send({ error: "scan_not_found" });
    }
    const meta = (scan.metadata ?? {}) as Record<string, unknown>;
    const costs = await getScanCosts(db, params.id);
    return {
      scanId: scan.id,
      status: scan.status,
      error: scan.error,
      grantsDiscovered: scan.grantsDiscovered,
      startedAt: scan.startedAt,
      finishedAt: scan.finishedAt,
      driver: meta.driver ?? null,
      recordingId: meta.recordingId ?? null,
      costs,
    };
  });

  app.get("/recordings", async () => {
    const ids = await listRecordings();
    return { recordings: ids };
  });

  app.get("/scans/:id/stream", async (req, reply) => {
    let params;
    try {
      params = scanIdParamSchema.parse(req.params);
    } catch (err) {
      if (err instanceof ZodError) return zodError(reply, err);
      throw err;
    }

    const scan = await getScanRun(db, params.id);
    if (!scan) {
      return reply.code(404).send({ error: "scan_not_found" });
    }

    const log = scanLog(req.log, params.id);
    initSse(reply);
    writeSse(reply, "snapshot", {
      scanId: params.id,
      status: scan.status,
      history: scanBus.history(params.id),
    });

    const unsubscribe = scanBus.subscribe(params.id, (event) => {
      writeSse(reply, event.type, event);
      if (
        event.type === "scan.completed" ||
        event.type === "scan.failed" ||
        event.type === "scan.cost_capped" ||
        event.type === "scan.partial"
      ) {
        reply.raw.end();
      }
    });

    // If already terminal, close after snapshot
    if (
      scan.status === "completed" ||
      scan.status === "failed" ||
      scan.status === "cost_capped" ||
      scan.status === "partial"
    ) {
      const eventType =
        scan.status === "completed"
          ? "scan.completed"
          : scan.status === "partial"
            ? "scan.partial"
            : scan.status === "cost_capped"
              ? "scan.cost_capped"
              : "scan.failed";
      writeSse(reply, eventType, {
        scanId: params.id,
        at: new Date().toISOString(),
        status: scan.status,
        error: scan.error,
        grantsDiscovered: scan.grantsDiscovered,
        costs: await getScanCosts(db, params.id),
      });
      unsubscribe();
      reply.raw.end();
      return;
    }

    const onClose = () => {
      unsubscribe();
      log.info("SSE client disconnected");
    };
    req.raw.on("close", onClose);
  });

  app.get("/scans/:id/cards", async (req, reply) => {
    let params;
    try {
      params = scanIdParamSchema.parse(req.params);
    } catch (err) {
      if (err instanceof ZodError) return zodError(reply, err);
      throw err;
    }

    const scan = await getScanRun(db, params.id);
    if (!scan) {
      return reply.code(404).send({ error: "scan_not_found" });
    }

    const cards = await listCardsForScan(db, params.id);
    const costs = await getScanCosts(db, params.id);
    const meta = (scan.metadata ?? {}) as Record<string, unknown>;
    return {
      scanId: params.id,
      status: scan.status,
      cards: cards.map(serializeCard),
      costs,
      driver: meta.driver ?? null,
      recordingId: meta.recordingId ?? null,
    };
  });

  app.post("/cards/:id/decision", async (req, reply) => {
    let params;
    let body;
    try {
      params = cardIdParamSchema.parse(req.params);
      body = cardDecisionBodySchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) return zodError(reply, err);
      throw err;
    }

    const card = await getApprovalCard(db, params.id);
    if (!card) {
      return reply.code(404).send({ error: "card_not_found" });
    }

    if (body.bulk === true && body.decision === "approve" && card.protected === true) {
      return reply.code(403).send({
        error: "protected_no_bulk",
        message:
          card.protectedReason ?? "Protected by keyring.yml — approve individually, never in bulk.",
      });
    }

    const status: ApprovalStatus =
      body.decision === "approve" ? "approved" : body.decision === "hold" ? "held" : "rejected";

    const decision: Decision = {
      by: body.by,
      at: new Date(),
      ...(body.note ? { note: body.note } : {}),
    };

    // Intent only — never executes
    const updated = await setCardDecision(db, params.id, status, decision);
    await appendChainedAudit(db, {
      cardId: card.id,
      action: body.decision,
      approvedBy: body.by,
      approvedAt: decision.at,
      executedAt: decision.at,
      result: "success",
      evidenceSnapshot: card.grant.evidence,
    });

    req.log.info(
      { cardId: params.id, decision: body.decision, by: body.by },
      "card decision recorded (intent only)",
    );

    return {
      card: updated ? serializeCard(updated) : null,
      message: "Decision recorded. Call POST /scans/:id/execute to apply approved actions.",
    };
  });

  app.post("/scans/:id/demo-reset", async (req, reply) => {
    if (process.env.KEYRING_DEMO !== "1") {
      return reply.code(404).send({ error: "not_found" });
    }

    let params;
    try {
      params = scanIdParamSchema.parse(req.params);
    } catch (err) {
      if (err instanceof ZodError) return zodError(reply, err);
      throw err;
    }

    const scan = await getScanRun(db, params.id);
    if (!scan) {
      return reply.code(404).send({ error: "scan_not_found" });
    }

    const reset = await resetDemoScan(db, params.id);
    return { scanId: params.id, reset };
  });

  app.post("/scans/:id/execute", async (req, reply) => {
    let params;
    let body;
    try {
      params = scanIdParamSchema.parse(req.params);
      body = executeScanBodySchema.parse(req.body ?? {});
    } catch (err) {
      if (err instanceof ZodError) return zodError(reply, err);
      throw err;
    }

    const scan = await getScanRun(db, params.id);
    if (!scan) {
      return reply.code(404).send({ error: "scan_not_found" });
    }

    const log = scanLog(req.log, params.id);
    const wantsStream =
      req.headers.accept?.includes("text/event-stream") ||
      (req.query as { stream?: string }).stream === "1";

    if (wantsStream) {
      initSse(reply);
      writeSse(reply, "execute.started", {
        scanId: params.id,
        at: new Date().toISOString(),
      });

      const summary = await executeApprovedCards({
        db,
        scanId: params.id,
        approvedBy: body.approvedBy,
        dryRun: body.dryRun,
        log,
        onEvent: (event) => writeSse(reply, event.type, event),
      });

      writeSse(reply, "execute.done", { scanId: params.id, ...summary });
      reply.raw.end();
      return;
    }

    const summary = await executeApprovedCards({
      db,
      scanId: params.id,
      approvedBy: body.approvedBy,
      dryRun: body.dryRun,
      log,
    });
    return { scanId: params.id, ...summary };
  });

  app.get("/audit", async (req, reply) => {
    let query;
    try {
      query = auditQuerySchema.parse(req.query);
    } catch (err) {
      if (err instanceof ZodError) return zodError(reply, err);
      throw err;
    }

    const records = await listAuditRecords(db, query);
    const verification = await verifyStoredAuditChain(db);

    return {
      records: records.map(serializeAudit),
      verification,
    };
  });

  app.get("/audit/export", async (req, reply) => {
    let query;
    try {
      query = auditExportQuerySchema.parse(req.query);
    } catch (err) {
      if (err instanceof ZodError) return zodError(reply, err);
      throw err;
    }

    const chain = await listAuditChain(db, { cardId: query.cardId });
    const verification = await verifyStoredAuditChain(db);
    const secret = process.env.KEYRING_EXPORT_SECRET ?? "keyring-dev-export-secret";

    if (query.format === "csv") {
      const header = "id,cardId,action,approvedBy,approvedAt,executedAt,result,error,prevHash,hash";
      const lines = chain.map((r) =>
        [
          r.id,
          r.cardId,
          r.action,
          r.approvedBy,
          r.approvedAt.toISOString(),
          r.executedAt.toISOString(),
          r.result,
          r.error ?? "",
          r.prevHash,
          r.hash,
        ]
          .map(csvEscape)
          .join(","),
      );
      const body = [header, ...lines].join("\n") + "\n";
      const { signature, algorithm } = signExport(body, secret);
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("x-keyring-signature", signature);
      reply.header("x-keyring-signature-alg", algorithm);
      reply.header("x-keyring-content-sha256", contentHash(body));
      reply.header("x-keyring-chain-ok", verification.ok ? "true" : "false");
      return reply.send(body);
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      verification,
      records: chain.map(serializeAudit),
    };
    const body = `${JSON.stringify(payload, null, 2)}\n`;
    const { signature, algorithm } = signExport(body, secret);
    reply.header("content-type", "application/json; charset=utf-8");
    reply.header("x-keyring-signature", signature);
    reply.header("x-keyring-signature-alg", algorithm);
    reply.header("x-keyring-content-sha256", contentHash(body));
    return reply.send({
      ...payload,
      signature: { algorithm, value: signature },
    });
  });
}

function serializeCard(card: Awaited<ReturnType<typeof getApprovalCard>>) {
  if (!card) return null;
  return {
    id: card.id,
    status: card.status,
    proposedAction: card.proposedAction,
    irreversible: card.irreversible,
    protected: card.protected === true,
    protectedReason: card.protectedReason ?? null,
    autoApprovedBy: card.autoApprovedBy ?? null,
    risk: card.risk,
    attribution: card.attribution,
    decision: card.decision
      ? {
          by: card.decision.by,
          at: card.decision.at.toISOString(),
          note: card.decision.note,
        }
      : null,
    grant: {
      id: card.grant.id,
      system: card.grant.system,
      capability: card.grant.capability,
      resource: card.grant.resource,
      principal: card.grant.principal,
      evidence: card.grant.evidence,
      revocable: card.grant.revocable,
      lastUsedAt: card.grant.lastUsedAt?.toISOString() ?? null,
      discoveredAt: card.grant.discoveredAt.toISOString(),
      createdAt: card.grant.createdAt?.toISOString() ?? null,
    },
  };
}

function serializeAudit(r: Awaited<ReturnType<typeof listAuditRecords>>[number]) {
  return {
    id: r.id,
    cardId: r.cardId,
    action: r.action,
    approvedBy: r.approvedBy,
    approvedAt: r.approvedAt.toISOString(),
    executedAt: r.executedAt.toISOString(),
    result: r.result,
    error: r.error ?? null,
    evidenceSnapshot: r.evidenceSnapshot,
    prevHash: r.prevHash,
    hash: r.hash,
  };
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export type { FastifyRequest };
