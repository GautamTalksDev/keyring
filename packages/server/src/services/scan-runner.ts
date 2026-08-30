import { buildApprovalCards, redactErrorMessage, type Grant } from "@keyring/core";
import type { FastifyBaseLogger } from "fastify";
import { TrueForge } from "@truefoundry/trueforge-sdk";

import {
  inventorySystem,
  limitDemoCards,
  listConnectedSystems,
  loadAllFixtureGrants,
  runIdentityReconciliation,
} from "../agent/scan.js";
import { newScanId, scanBus, scanLog, type ScanProgressEvent } from "../api/progress.js";
import type { CreateScanBody } from "../api/schemas.js";
import { loadCostConfig, modelForRole } from "../costs/config.js";
import { CostCapExceededError, ScanCostLedger, type ScanCostSnapshot } from "../costs/ledger.js";
import type { Database } from "../db/client.js";
import {
  createScanRun,
  finishScanRun,
  getPreviousCompletedScan,
  getScanRun,
  updateScanMetadata,
  upsertApprovalCard,
  upsertGrant,
} from "../db/store.js";
import { classifyProductError, recoveryFor } from "../errors/classify.js";
import { ScanRecorder } from "../recording/recorder.js";
import { loadRecording, saveRecording } from "../recording/store.js";
import { recordingIdFromPerson, type ScanRecording } from "../recording/types.js";
import { diffGrantSnapshots, filterCardsToDiff, type ScanDiff } from "./scan-diff.js";
export type ScanDriver = "fixture" | "trueforge" | "record" | "replay";

export interface StartScanResult {
  scanId: string;
  driver: ScanDriver;
  status: "running";
  recordingId?: string;
}

const DEMO_SYSTEM_STAGGER_MS: Record<string, number> = {
  aws: 80,
  notion: 160,
  slack: 240,
  github: 320,
  google_workspace: 400,
};

function resolveDriver(override?: ScanDriver): ScanDriver {
  if (override) return override;
  const env = process.env.KEYRING_SCAN_DRIVER;
  if (env === "trueforge" || env === "record" || env === "replay") return env;
  return "fixture";
}

function publish(event: ScanProgressEvent, recorder?: ScanRecorder): void {
  recorder?.addEvent(event);
  scanBus.publish(event);
}

function publishCost(scanId: string, costs: ScanCostSnapshot, recorder?: ScanRecorder): void {
  publish(
    {
      type: "cost.update",
      scanId,
      at: new Date().toISOString(),
      inputTokens: costs.inputTokens,
      outputTokens: costs.outputTokens,
      costUsd: costs.costUsd,
      hardCapUsd: costs.hardCapUsd,
      capped: costs.capped,
    },
    recorder,
  );
}

/**
 * Start a scan. Returns immediately with scanId; work continues in background.
 *
 * Drivers:
 * - fixture — local FixtureConnector fan-out + estimated model costs
 * - trueforge — TrueForge SDK agent turn (real provider); usage from model.message
 * - record — fixture (or trueforge if KEYRING_RECORD_WITH=trueforge) + write fixtures/recordings/
 * - replay — zero API calls from a recording
 */
export async function startScan(
  db: Database["db"],
  body: CreateScanBody,
  log: FastifyBaseLogger,
): Promise<StartScanResult> {
  const scanId = newScanId();
  const driver = resolveDriver(body.driver);
  const logger = scanLog(log, scanId);
  const recordingId =
    body.recordingId ?? (body.person ? recordingIdFromPerson(body.person) : "scan");

  await createScanRun(db, {
    id: scanId,
    connectorId:
      driver === "trueforge"
        ? "trueforge-agent"
        : driver === "replay"
          ? "replay"
          : driver === "record"
            ? "record"
            : "fixture-fanout",
    status: "running",
    metadata: {
      person: body.person ?? null,
      scope: body.scope ?? null,
      driver,
      recordingId,
      cardIds: [],
      costs: null,
    },
  });

  publish({
    type: "scan.started",
    scanId,
    ...(body.person ? { person: body.person } : {}),
    ...(body.scope ? { scope: body.scope } : {}),
    driver,
    at: new Date().toISOString(),
  });
  logger.info({ driver, person: body.person, recordingId }, "scan started");

  let scanLedger: ScanCostLedger | undefined;
  void (async () => {
    try {
      if (driver === "replay") {
        await runReplay(db, scanId, recordingId, logger);
        return;
      }

      if (driver === "trueforge" || body.recordWith === "trueforge") {
        const ledger = new ScanCostLedger();
        scanLedger = ledger;
        const recorder = driver === "record" ? new ScanRecorder() : undefined;
        await driveTrueForgeAgent(db, scanId, body, logger, ledger, recorder);
        await runFixtureFanOutAndPersist(db, scanId, body, logger, {
          emitSubagents: false,
          ledger,
          recorder,
          record: driver === "record",
          recordingId,
        });
        return;
      }

      // fixture or record (fixture backend)
      const ledger = new ScanCostLedger();
      scanLedger = ledger;
      const recorder = driver === "record" ? new ScanRecorder() : undefined;
      await runFixtureFanOutAndPersist(db, scanId, body, logger, {
        emitSubagents: true,
        ledger,
        recorder,
        record: driver === "record",
        recordingId,
      });
    } catch (err) {
      if (err instanceof CostCapExceededError) {
        logger.warn({ costUsd: err.costUsd }, "scan cost capped");
        const costs = scanLedger?.snapshot() ?? {
          inputTokens: 0,
          outputTokens: 0,
          costUsd: err.costUsd,
          hardCapUsd: err.hardCapUsd,
          capped: true,
          lines: [],
        };
        const classified = classifyProductError(err, "cost_capped");
        await updateScanMetadata(db, scanId, {
          person: body.person ?? null,
          scope: body.scope ?? null,
          driver,
          recordingId,
          cardIds: [],
          costs,
          errorKind: classified.kind,
          recovery: classified.recovery,
        });
        await finishScanRun(db, {
          id: scanId,
          status: "cost_capped",
          grantsDiscovered: 0,
          error: err.message,
        });
        publish({
          type: "scan.cost_capped",
          scanId,
          at: new Date().toISOString(),
          error: err.message,
          errorKind: classified.kind,
          recovery: classified.recovery,
          costs,
        });
        return;
      }
      const classified = classifyProductError(err);
      logger.error({ err, errorKind: classified.kind }, "scan failed");
      await updateScanMetadata(db, scanId, {
        person: body.person ?? null,
        scope: body.scope ?? null,
        driver,
        recordingId,
        errorKind: classified.kind,
        recovery: classified.recovery,
      });
      await finishScanRun(db, {
        id: scanId,
        status: "failed",
        grantsDiscovered: 0,
        error: classified.message,
      });
      publish({
        type: "scan.failed",
        scanId,
        at: new Date().toISOString(),
        error: classified.message,
        errorKind: classified.kind,
        recovery: classified.recovery,
      });
    }
  })();

  return {
    scanId,
    driver,
    status: "running",
    ...(driver === "record" || driver === "replay" ? { recordingId } : {}),
  };
}

async function runFixtureFanOutAndPersist(
  db: Database["db"],
  scanId: string,
  body: CreateScanBody,
  log: FastifyBaseLogger,
  opts: {
    emitSubagents: boolean;
    ledger: ScanCostLedger;
    recorder?: ScanRecorder;
    record?: boolean;
    recordingId?: string;
  },
): Promise<void> {
  const cfg = loadCostConfig();
  const delay = body.delayMsPerGrant ?? Number(process.env.KEYRING_SCAN_DELAY_MS ?? 0);
  const systems = await listConnectedSystems();
  const mergedIds: string[] = [];
  type FailedSystem = {
    systemId: string;
    error: string;
    errorKind: string;
  };
  const failedSystemsById = new Map<string, FailedSystem>();
  const successfulSystems = new Set<string>();
  const { ledger, recorder } = opts;
  const fanOutController = new AbortController();

  if (opts.emitSubagents) {
    for (const system of systems) {
      publish(
        {
          type: "subagent.queued",
          scanId,
          systemId: system.id,
          displayName: system.displayName,
          at: new Date().toISOString(),
        },
        recorder,
      );
    }
  }

  const grantsBySystem = new Map<string, string[]>();
  const inventoryTasks = systems.map(async (system) => {
    if (opts.emitSubagents) {
      publish(
        {
          type: "subagent.started",
          scanId,
          systemId: system.id,
          displayName: system.displayName,
          at: new Date().toISOString(),
        },
        recorder,
      );
      log.info({ systemId: system.id }, "subagent started");
    }

    try {
      // Mechanical inventory summarisation — cheap model role
      const invModel = modelForRole("inventory");
      const invIn = 800;
      const invOut = 200;
      try {
        const snap = ledger.recordModelCall({
          role: "inventory",
          model: invModel,
          inputTokens: invIn,
          outputTokens: invOut,
          note: `inventory_system:${system.id}`,
        });
        publishCost(scanId, snap, recorder);
        recorder?.addModel({
          at: new Date().toISOString(),
          role: "inventory",
          model: invModel,
          inputTokens: invIn,
          outputTokens: invOut,
          costUsd: snap.lines.at(-1)?.costUsd ?? 0,
          inputSummary: `Summarise inventory for ${system.id}`,
          outputSummary: `compact grants for ${system.id}`,
        });
      } catch (err) {
        if (err instanceof CostCapExceededError) {
          publishCost(scanId, ledger.snapshot(), recorder);
          throw err;
        }
        throw err;
      }

      if (opts.emitSubagents && opts.record) {
        await pause(DEMO_SYSTEM_STAGGER_MS[system.id] ?? 200, fanOutController.signal);
      }
      const result = await inventorySystem(system.id, {
        delayMsPerGrant: opts.emitSubagents ? delay : 0,
        signal: fanOutController.signal,
        onGrant: opts.emitSubagents
          ? (found) => {
              publish(
                {
                  type: "subagent.progress",
                  scanId,
                  systemId: system.id,
                  found,
                  at: new Date().toISOString(),
                },
                recorder,
              );
            }
          : undefined,
      });
      grantsBySystem.set(
        system.id,
        result.grants.map((grant) => grant.id),
      );
      successfulSystems.add(system.id);

      recorder?.addTool({
        at: new Date().toISOString(),
        tool: "inventory_system",
        arguments: { system_id: system.id },
        resultSummary: `${result.count} grants`,
      });

      if (opts.emitSubagents) {
        publish(
          {
            type: "subagent.done",
            scanId,
            systemId: system.id,
            found: result.count,
            at: new Date().toISOString(),
          },
          recorder,
        );
        log.info({ systemId: system.id, found: result.count }, "subagent done");
      }
    } catch (err) {
      if (err instanceof CostCapExceededError) throw err;
      if (fanOutController.signal.aborted) throw err;
      const classified = classifyProductError(err);
      failedSystemsById.set(system.id, {
        systemId: system.id,
        error: classified.message,
        errorKind: classified.kind,
      });
      publish(
        {
          type: "subagent.failed",
          scanId,
          systemId: system.id,
          displayName: system.displayName,
          at: new Date().toISOString(),
          error: classified.message,
          errorKind: classified.kind,
          recovery: classified.recovery,
        },
        recorder,
      );
      log.warn(
        {
          systemId: system.id,
          error: redactErrorMessage(err instanceof Error ? err.message : String(err)),
          errorKind: classified.kind,
        },
        "subagent failed, continuing partial scan",
      );
    }
  });
  try {
    await Promise.all(inventoryTasks);
  } catch (err) {
    fanOutController.abort(err);
    await Promise.allSettled(inventoryTasks);
    throw err;
  }
  const failedSystems = systems
    .map((system) => failedSystemsById.get(system.id))
    .filter((failure): failure is NonNullable<typeof failure> => Boolean(failure));
  for (const system of systems) {
    for (const grantId of grantsBySystem.get(system.id) ?? []) {
      mergedIds.push(grantId);
    }
  }

  if (failedSystems.length > 0 && successfulSystems.size === 0) {
    const first = failedSystems[0]!;
    const err = new Error(`All connectors failed (first: ${first.systemId}: ${first.error})`);
    Object.assign(err, { status: first.errorKind === "rate_limit" ? 429 : 401 });
    throw err;
  }

  publish(
    {
      type: "reconcile.started",
      scanId,
      at: new Date().toISOString(),
    },
    recorder,
  );

  // Stronger model for reconciliation + risk reasoning
  const reasonModel = modelForRole("reasoning");
  const reasonIn = 2500;
  const reasonOut = 1200;
  try {
    const snap = ledger.recordModelCall({
      role: "reasoning",
      model: reasonModel,
      inputTokens: reasonIn,
      outputTokens: reasonOut,
      note: "identity_reconciliation+risk",
    });
    publishCost(scanId, snap, recorder);
    recorder?.addModel({
      at: new Date().toISOString(),
      role: "reasoning",
      model: reasonModel,
      inputTokens: reasonIn,
      outputTokens: reasonOut,
      costUsd: snap.lines.at(-1)?.costUsd ?? 0,
      inputSummary: `Reconcile ${mergedIds.length} grants + risk`,
      outputSummary: "clusters, unknown bucket, risk reasons",
    });
  } catch (err) {
    if (err instanceof CostCapExceededError) {
      publishCost(scanId, ledger.snapshot(), recorder);
      throw err;
    }
    throw err;
  }

  const { reconciliation, policy } = await runIdentityReconciliation(mergedIds);
  recorder?.addTool({
    at: new Date().toISOString(),
    tool: "run_identity_reconciliation",
    arguments: { grant_ids: mergedIds },
    resultSummary: `${reconciliation.clusters.length} clusters, ${reconciliation.unknown.grantIds.length} unknown`,
  });

  const grants = (await loadAllFixtureGrants()).filter((g) => mergedIds.includes(g.id));
  let cards = buildApprovalCards({ grants, reconciliation, policy });

  if (body.person) {
    const hint = body.person.toLowerCase();
    cards = cards.filter(
      (c) =>
        c.attribution.reasoning.toLowerCase().includes(hint) ||
        c.grant.principal.identifiers.some((i) => i.value.toLowerCase().includes(hint)) ||
        c.grant.principal.kind === "ai_agent" ||
        c.status === "held" ||
        c.attribution.resolvedTo === undefined ||
        c.protected === true,
    );
  }

  // Re-audit diff vs previous completed scan
  let diff: ScanDiff | null = null;
  const wantDiff =
    body.reaudit === true || body.diffOnly === true || policy.reaudit?.diff_only === true;
  const prev = await getPreviousCompletedScan(db, scanId);
  const prevMeta = (prev?.metadata ?? null) as {
    grantIds?: string[];
    grants?: Array<{
      id: string;
      system: string;
      capability: string;
      resourceId: string;
    }>;
  } | null;
  diff = diffGrantSnapshots(
    {
      scanId,
      grantIds: grants.map((g) => g.id),
      grants: grants.map((g) => ({
        id: g.id,
        system: g.system,
        capability: g.capability,
        resourceId: g.resource.id,
      })),
    },
    prev && prevMeta?.grantIds
      ? {
          scanId: prev.id,
          grantIds: prevMeta.grantIds,
          grants: prevMeta.grants,
        }
      : null,
  );
  const diffOnly =
    body.diffOnly === true ||
    (body.reaudit === true && body.diffOnly !== false && (policy.reaudit?.diff_only ?? true));

  publish(
    {
      type: "scan.diff",
      scanId,
      at: new Date().toISOString(),
      baselineScanId: diff.baselineScanId,
      added: diff.added.length,
      removed: diff.removed.length,
      changed: diff.changed.length,
      unchanged: diff.unchanged.length,
      diffOnly: Boolean(wantDiff && diffOnly && diff.baselineScanId),
    },
    recorder,
  );

  if (wantDiff && diffOnly && diff.baselineScanId) {
    cards = filterCardsToDiff(cards, diff);
  }
  cards = limitDemoCards(cards);
  const identityCounts = countIdentityKinds(grants);

  publish(
    {
      type: "reconcile.done",
      scanId,
      at: new Date().toISOString(),
      clusters: reconciliation.clusters.length,
      unknown: reconciliation.unknown.grantIds.length,
    },
    recorder,
  );

  for (const grant of grants) {
    await upsertGrant(db, grant);
  }
  const cardIds: string[] = [];
  for (const card of cards) {
    await upsertApprovalCard(db, card, scanId);
    cardIds.push(card.id);
  }

  const costs = ledger.snapshot();
  const isPartial = failedSystems.length > 0;
  await updateScanMetadata(db, scanId, {
    person: body.person ?? null,
    scope: body.scope ?? null,
    driver: opts.record ? "record" : opts.emitSubagents ? "fixture" : "trueforge",
    cardIds,
    grantIds: grants.map((g) => g.id),
    grants: grants.map((g) => ({
      id: g.id,
      system: g.system,
      capability: g.capability,
      resourceId: g.resource.id,
    })),
    clusters: reconciliation.clusters.length,
    unknown: reconciliation.unknown.grantIds.length,
    ...identityCounts,
    cardCount: cards.length,
    systemCount: new Set(grants.map((grant) => grant.system)).size,
    costs,
    recordingId: opts.recordingId ?? null,
    reaudit: body.reaudit ?? false,
    partial: isPartial,
    failedSystems,
    ...(isPartial
      ? {
          errorKind: "partial" as const,
          recovery: recoveryFor("partial"),
        }
      : {}),
    diff: diff
      ? {
          baselineScanId: diff.baselineScanId,
          added: diff.added.length,
          removed: diff.removed.length,
          changed: diff.changed.length,
          unchanged: diff.unchanged.length,
        }
      : null,
  });
  publish(
    {
      type: "cards.persisted",
      scanId,
      cardCount: cards.length,
      ...identityCounts,
      systemCount: new Set(grants.map((grant) => grant.system)).size,
      at: new Date().toISOString(),
    },
    recorder,
  );

  if (opts.record && recorder && opts.recordingId) {
    const recording = recorder.build({
      id: opts.recordingId,
      person: body.person ?? null,
      scope: body.scope ?? null,
      driver: "record",
      models: cfg.models,
      costs,
      cards: cards.map(serializeCardForRecording),
      reconciliation,
      grantIds: mergedIds,
    });
    const dest = await saveRecording(recording);
    log.info({ dest, recordingId: opts.recordingId }, "scan recording saved");
  }

  await finishScanRun(db, {
    id: scanId,
    status: isPartial ? "partial" : "completed",
    grantsDiscovered: grants.length,
    error: isPartial
      ? `Partial scan: ${failedSystems.map((f) => f.systemId).join(", ")} failed`
      : undefined,
  });

  publish(
    {
      type: isPartial ? "scan.partial" : "scan.completed",
      scanId,
      at: new Date().toISOString(),
      grantsDiscovered: grants.length,
      costs,
      ...(isPartial
        ? {
            error: `Partial scan — ${failedSystems.length} system(s) failed`,
            errorKind: "partial",
            recovery: recoveryFor("partial"),
            failedSystems: failedSystems.map((f) => f.systemId),
          }
        : {}),
    },
    recorder,
  );
  log.info(
    { grants: grants.length, cards: cards.length, costs, isPartial },
    isPartial ? "scan partial" : "scan completed",
  );
}

async function runReplay(
  db: Database["db"],
  scanId: string,
  recordingId: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const recording = await loadRecording(recordingId);
  const replaySpeed = positiveNumberEnv("KEYRING_REPLAY_SPEED", 1);
  const replayMaxGapMs = positiveNumberEnv("KEYRING_REPLAY_MAX_GAP_MS", 180);
  log.info(
    {
      recordingId,
      interactions: recording.interactions.length,
      replaySpeed,
    },
    "replaying recording (zero API calls)",
  );

  // Re-emit events with this scanId so SSE clients see live progress
  let previousEventAt: number | null = null;
  for (const event of recording.events) {
    const eventAt = Date.parse(event.at);
    if (previousEventAt !== null && Number.isFinite(eventAt)) {
      const recordedGap = Math.max(0, eventAt - previousEventAt);
      await pause(Math.min(Math.max(recordedGap * replaySpeed, 8), replayMaxGapMs));
    }
    const rewritten = { ...event, scanId } as ScanProgressEvent;
    scanBus.publish(rewritten);
    previousEventAt = Number.isFinite(eventAt) ? eventAt : previousEventAt;
  }

  const grants = await loadAllFixtureGrants();
  const byId = new Map(grants.map((g) => [g.id as string, g]));
  for (const gid of recording.grantIds) {
    const g = byId.get(gid);
    if (g) await upsertGrant(db, g);
  }

  // Prefer cards from recording; rebuild if needed
  let cards = recording.cards as ReturnType<typeof serializeCardForRecording>[];
  if (!Array.isArray(cards) || cards.length === 0) {
    const selected = recording.grantIds
      .map((id) => byId.get(id))
      .filter((g): g is NonNullable<typeof g> => Boolean(g));
    const reconciliation =
      recording.reconciliation ??
      (await runIdentityReconciliation(recording.grantIds)).reconciliation;
    const { policy } = await runIdentityReconciliation(recording.grantIds);
    cards = buildApprovalCards({
      grants: selected,
      reconciliation,
      policy,
    }).map(serializeCardForRecording);
  }

  // Persist domain cards from grant rebuild for FK integrity
  const selectedGrants = recording.grantIds
    .map((id) => byId.get(id))
    .filter((g): g is NonNullable<typeof g> => Boolean(g));
  const { reconciliation, policy } = await runIdentityReconciliation(recording.grantIds);
  const recon = recording.reconciliation ?? reconciliation;
  let domainCards = buildApprovalCards({
    grants: selectedGrants,
    reconciliation: recon,
    policy,
  });
  if (recording.person) {
    const hint = recording.person.toLowerCase();
    domainCards = domainCards.filter(
      (c) =>
        c.attribution.reasoning.toLowerCase().includes(hint) ||
        c.grant.principal.identifiers.some((i) => i.value.toLowerCase().includes(hint)) ||
        c.grant.principal.kind === "ai_agent" ||
        c.status === "held" ||
        c.attribution.resolvedTo === undefined,
    );
  }
  domainCards = limitDemoCards(domainCards);
  for (const card of domainCards) {
    await upsertApprovalCard(db, card, scanId);
  }

  await updateScanMetadata(db, scanId, {
    person: recording.person,
    scope: recording.scope,
    driver: "replay",
    recordingId,
    cardIds: domainCards.map((c) => c.id),
    costs: recording.costs,
    replayedFrom: recording.recordedAt,
  });

  await finishScanRun(db, {
    id: scanId,
    status: "completed",
    grantsDiscovered: recording.grantIds.length,
  });

  // Ensure terminal cost + completed events even if recording omitted them
  scanBus.publish({
    type: "cost.update",
    scanId,
    at: new Date().toISOString(),
    inputTokens: recording.costs.inputTokens,
    outputTokens: recording.costs.outputTokens,
    costUsd: recording.costs.costUsd,
    hardCapUsd: recording.costs.hardCapUsd,
    capped: recording.costs.capped,
  });
  scanBus.publish({
    type: "scan.completed",
    scanId,
    at: new Date().toISOString(),
    grantsDiscovered: recording.grantIds.length,
    costs: recording.costs,
  });

  void cards;
}

async function driveTrueForgeAgent(
  db: Database["db"],
  scanId: string,
  body: CreateScanBody,
  log: FastifyBaseLogger,
  ledger: ScanCostLedger,
  recorder?: ScanRecorder,
): Promise<void> {
  const baseUrl = process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8791";
  const agentName = process.env.KEYRING_AGENT_NAME ?? "keyring";
  const client = new TrueForge({
    baseUrl,
    timeoutInSeconds: 600,
    ...(process.env.TRUEFORGE_TOKEN ? { token: process.env.TRUEFORGE_TOKEN } : {}),
  });

  const prompt = body.person
    ? `audit access for ${body.person}`
    : `audit access for scope ${body.scope}`;

  const sessionRes = await client.sessions.create({
    agent: { name: agentName },
  });
  const session = sessionRes.data;
  log.info({ sessionId: session.id }, "TrueForge session created");

  await updateScanMetadata(db, scanId, {
    person: body.person ?? null,
    scope: body.scope ?? null,
    driver: "trueforge",
    sessionId: session.id,
    cardIds: [],
  });

  const stream = await client.sessions.createTurnStream(session.id, {
    input: [{ type: "user.message", content: prompt }],
  });

  for await (const { data: event } of stream.withMetadata()) {
    const eventType = (event as { type?: string }).type ?? "unknown";
    const threadId = (event as { threadId?: string | null }).threadId ?? null;

    if (eventType === "model.message") {
      const usage = (
        event as {
          usage?: { input_tokens?: number; output_tokens?: number };
        }
      ).usage;
      if (usage) {
        const role = threadId && threadId !== "main" ? "inventory" : "reasoning";
        try {
          const snap = ledger.recordModelCall({
            role,
            model: modelForRole(role),
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            note: `trueforge:${eventType}`,
          });
          publishCost(scanId, snap, recorder);
        } catch (err) {
          if (err instanceof CostCapExceededError) {
            try {
              await client.sessions.cancel(session.id);
            } catch {
              /* best effort */
            }
            publishCost(scanId, ledger.snapshot(), recorder);
            throw err;
          }
          throw err;
        }
      }
    }

    if (eventType === "thread.created") {
      const title = (event as { title?: string }).title ?? "subagent";
      const systemId = title.replace(/^scan:/, "") || title;
      publish(
        {
          type: "subagent.started",
          scanId,
          systemId,
          displayName: title,
          at: new Date().toISOString(),
        },
        recorder,
      );
    }

    if (eventType === "thread.done") {
      publish(
        {
          type: "subagent.done",
          scanId,
          systemId: threadId ?? "subagent",
          found: 0,
          at: new Date().toISOString(),
        },
        recorder,
      );
    }

    if (eventType === "tool.response") {
      recorder?.addTool({
        at: new Date().toISOString(),
        tool: String((event as { name?: string }).name ?? "tool"),
        arguments: {},
        resultSummary: "tool.response",
      });
    }

    publish(
      {
        type: "trueforge.event",
        scanId,
        at: new Date().toISOString(),
        eventType,
        threadId,
        detail: summarizeTfEvent(event),
      },
      recorder,
    );

    if (eventType === "turn.done") {
      const status = (event as { state?: { status?: string } }).state?.status;
      if (status === "error") {
        throw new Error("TrueForge turn ended in error");
      }
    }
  }
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });
}

function positiveNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function serializeCardForRecording(card: {
  id: string;
  status: string;
  proposedAction: unknown;
  irreversible: boolean;
  risk: unknown;
  attribution: unknown;
  grant: { id: string };
}): unknown {
  return {
    id: card.id,
    status: card.status,
    proposedAction: card.proposedAction,
    irreversible: card.irreversible,
    risk: card.risk,
    attribution: card.attribution,
    grantId: card.grant.id,
  };
}

function countIdentityKinds(grants: Array<{ principal: Grant["principal"] }>): {
  humanIdentityCount: number;
  agentIdentityCount: number;
} {
  const humans = new Set<string>();
  const agents = new Set<string>();
  for (const grant of grants) {
    if (grant.principal.kind === "ai_agent") {
      agents.add(
        grant.principal.identifiers.find((identifier) => identifier.kind === "agent_id")?.value ??
          grant.principal.agentName,
      );
    } else if (grant.principal.kind === "human") {
      humans.add(
        grant.principal.identifiers
          .map((identifier) => `${identifier.kind}:${identifier.value}`)
          .sort()
          .join("|"),
      );
    }
  }
  return { humanIdentityCount: humans.size, agentIdentityCount: agents.size };
}

function summarizeTfEvent(event: unknown): string | undefined {
  const e = event as {
    type?: string;
    title?: string;
    name?: string;
    toolName?: string;
  };
  return e.title ?? e.toolName ?? e.name ?? e.type;
}

export async function getScanCosts(
  db: Database["db"],
  scanId: string,
): Promise<ScanCostSnapshot | null> {
  const row = await getScanRun(db, scanId);
  const meta = row?.metadata as { costs?: ScanCostSnapshot } | null;
  return meta?.costs ?? null;
}

export type { ScanRecording };
