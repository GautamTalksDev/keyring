import {
  appendAuditRecord,
  asApprovalCardId,
  asHashHex,
  GENESIS_HASH,
  type ApprovalCard,
  type ApprovalStatus,
  type AuditRecord,
  type Decision,
  type Grant,
  verifyAuditChain,
} from "@keyring/core";
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";

import type { AppDb, Database } from "./client.js";
import { approvalCards, auditRecords, grants, scanRuns } from "./schema.js";

/** Serialize hash-chain appends so two writers cannot share a prevHash. */
const AUDIT_CHAIN_LOCK = sql`SELECT pg_advisory_xact_lock(hashtext('keyring.audit_records.chain'))`;

export async function upsertGrant(db: Database["db"], grant: Grant): Promise<void> {
  await db
    .insert(grants)
    .values({
      id: grant.id,
      system: grant.system,
      principal: grant.principal,
      resource: grant.resource,
      capability: grant.capability,
      createdAt: grant.createdAt,
      lastUsedAt: grant.lastUsedAt,
      discoveredAt: grant.discoveredAt,
      revocable: grant.revocable,
      evidence: grant.evidence,
    })
    .onConflictDoUpdate({
      target: grants.id,
      set: {
        system: grant.system,
        principal: grant.principal,
        resource: grant.resource,
        capability: grant.capability,
        createdAt: grant.createdAt,
        lastUsedAt: grant.lastUsedAt,
        discoveredAt: grant.discoveredAt,
        revocable: grant.revocable,
        evidence: grant.evidence,
      },
    });
}

export async function insertApprovalCard(
  db: Database["db"],
  card: ApprovalCard,
  scanId?: string,
): Promise<void> {
  await db.insert(approvalCards).values({
    id: card.id,
    grantId: card.grant.id,
    grantSnapshot: card.grant,
    proposedAction: card.proposedAction,
    irreversible: card.irreversible,
    risk: card.risk,
    attribution: card.attribution,
    status: card.status,
    decision: card.decision ?? null,
    scanId: scanId ?? null,
  });
}

export async function upsertApprovalCard(
  db: Database["db"],
  card: ApprovalCard,
  scanId?: string,
): Promise<void> {
  const attribution = {
    ...card.attribution,
    ...(card.protected
      ? {
          protected: true,
          protectedReason: card.protectedReason,
        }
      : {}),
    ...(card.autoApprovedBy ? { autoApprovedBy: card.autoApprovedBy } : {}),
  };
  await db
    .insert(approvalCards)
    .values({
      id: card.id,
      grantId: card.grant.id,
      grantSnapshot: card.grant,
      proposedAction: card.proposedAction,
      irreversible: card.irreversible,
      risk: card.risk,
      attribution,
      status: card.status,
      decision: card.decision ?? null,
      scanId: scanId ?? null,
    })
    .onConflictDoUpdate({
      target: approvalCards.id,
      set: {
        grantSnapshot: card.grant,
        proposedAction: card.proposedAction,
        irreversible: card.irreversible,
        risk: card.risk,
        attribution,
        status: card.status,
        decision: card.decision ?? null,
        scanId: scanId ?? null,
        updatedAt: new Date(),
      },
    });
}

export async function appendAuditRecordRow(db: Database["db"], record: AuditRecord): Promise<void> {
  await db.insert(auditRecords).values({
    id: record.id,
    cardId: record.cardId,
    action: record.action,
    approvedBy: record.approvedBy,
    approvedAt: record.approvedAt,
    executedAt: record.executedAt,
    result: record.result,
    error: record.error,
    evidenceSnapshot: record.evidenceSnapshot,
    prevHash: record.prevHash,
    hash: record.hash,
  });
}

export async function createScanRun(
  db: Database["db"],
  input: {
    id: string;
    connectorId: string;
    status: string;
    metadata?: unknown;
  },
): Promise<void> {
  await db.insert(scanRuns).values({
    id: input.id,
    connectorId: input.connectorId,
    status: input.status,
    metadata: input.metadata ?? null,
  });
}

export async function finishScanRun(
  db: Database["db"],
  input: {
    id: string;
    status: string;
    grantsDiscovered: number;
    error?: string;
    metadata?: unknown;
  },
): Promise<void> {
  await db
    .update(scanRuns)
    .set({
      status: input.status,
      grantsDiscovered: input.grantsDiscovered,
      finishedAt: new Date(),
      error: input.error,
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    })
    .where(eq(scanRuns.id, input.id));
}

export async function getScanRun(db: Database["db"], id: string) {
  const rows = await db.select().from(scanRuns).where(eq(scanRuns.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateScanMetadata(
  db: Database["db"],
  id: string,
  metadata: unknown,
): Promise<void> {
  await db.update(scanRuns).set({ metadata }).where(eq(scanRuns.id, id));
}

export async function listCardsForScan(
  db: Database["db"],
  scanId: string,
): Promise<ApprovalCard[]> {
  const rows = await db
    .select()
    .from(approvalCards)
    .where(eq(approvalCards.scanId, scanId))
    .orderBy(desc(approvalCards.createdAt));
  return rows.map(rowToCard);
}

export async function getApprovalCard(
  db: Database["db"],
  cardId: string,
): Promise<ApprovalCard | null> {
  const rows = await db.select().from(approvalCards).where(eq(approvalCards.id, cardId)).limit(1);
  const row = rows[0];
  return row ? rowToCard(row) : null;
}

export async function setCardDecision(
  db: Database["db"],
  cardId: string,
  status: ApprovalStatus,
  decision: Decision,
): Promise<ApprovalCard | null> {
  await db
    .update(approvalCards)
    .set({
      status,
      decision,
      updatedAt: new Date(),
    })
    .where(eq(approvalCards.id, cardId));
  return getApprovalCard(db, cardId);
}

/**
 * Reset card decisions after an aborted demo take. Audit records are never
 * deleted, even in demo mode, because the database trigger is append-only.
 */
export async function resetDemoScan(db: Database["db"], scanId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const cards = await tx
      .select({ id: approvalCards.id })
      .from(approvalCards)
      .where(eq(approvalCards.scanId, scanId));

    await tx
      .update(approvalCards)
      .set({
        status: "pending",
        decision: null,
        updatedAt: new Date(),
      })
      .where(eq(approvalCards.scanId, scanId));

    return cards.length;
  });
}

export async function listApprovedCardsForScan(
  db: Database["db"],
  scanId: string,
): Promise<ApprovalCard[]> {
  const rows = await db
    .select()
    .from(approvalCards)
    .where(and(eq(approvalCards.scanId, scanId), eq(approvalCards.status, "approved")));
  return rows.map(rowToCard);
}

/**
 * Most recent completed scan before `beforeScanId` (for re-audit diffs).
 */
export async function getPreviousCompletedScan(
  db: Database["db"],
  beforeScanId: string,
): Promise<typeof scanRuns.$inferSelect | null> {
  const current = await getScanRun(db, beforeScanId);
  const before = current?.startedAt ?? new Date();
  const rows = await db
    .select()
    .from(scanRuns)
    .where(and(eq(scanRuns.status, "completed"), lt(scanRuns.startedAt, before)))
    .orderBy(desc(scanRuns.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * True when this card already has a real successful execute_* outcome
 * (excludes dry_run and attempt_started partials). Enables independent retries.
 */
export async function hasSuccessfulExecute(db: Database["db"], cardId: string): Promise<boolean> {
  const rows = await db
    .select({
      action: auditRecords.action,
      result: auditRecords.result,
      error: auditRecords.error,
    })
    .from(auditRecords)
    .where(eq(auditRecords.cardId, cardId));

  return rows.some(
    (r) =>
      r.action.startsWith("execute_") &&
      r.result === "success" &&
      r.error !== "dry_run" &&
      r.error !== "attempt_started" &&
      r.error !== "dry_run_attempt_started",
  );
}

export async function getLatestAuditHash(db: AppDb): Promise<typeof GENESIS_HASH> {
  const rows = await db
    .select({ hash: auditRecords.hash })
    .from(auditRecords)
    .orderBy(desc(auditRecords.seq))
    .limit(1);
  const hash = rows[0]?.hash;
  return hash ? asHashHex(hash) : GENESIS_HASH;
}

export async function listAuditRecords(
  db: Database["db"],
  opts: {
    cardId?: string;
    action?: string;
    limit: number;
    offset: number;
  },
): Promise<AuditRecord[]> {
  const conditions = [];
  if (opts.cardId) conditions.push(eq(auditRecords.cardId, opts.cardId));
  if (opts.action) conditions.push(eq(auditRecords.action, opts.action));

  const rows = await db
    .select()
    .from(auditRecords)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(auditRecords.seq))
    .limit(opts.limit)
    .offset(opts.offset);

  return rows.map(rowToAudit);
}

/** Full ordered chain for verification (ignores filters except optional cardId). */
export async function listAuditChain(
  db: Database["db"],
  opts: { cardId?: string } = {},
): Promise<AuditRecord[]> {
  const rows = await db
    .select()
    .from(auditRecords)
    .where(opts.cardId ? eq(auditRecords.cardId, opts.cardId) : undefined)
    .orderBy(asc(auditRecords.seq));
  return rows.map(rowToAudit);
}

export async function verifyStoredAuditChain(
  db: Database["db"],
): Promise<ReturnType<typeof verifyAuditChain> & { count: number }> {
  const chain = await listAuditChain(db);
  return { ...verifyAuditChain(chain), count: chain.length };
}

export async function appendChainedAudit(
  db: AppDb,
  input: Omit<Parameters<typeof appendAuditRecord>[0], "prevHash"> & {
    prevHash?: typeof GENESIS_HASH;
  },
): Promise<AuditRecord> {
  return await db.transaction(async (tx) => {
    await tx.execute(AUDIT_CHAIN_LOCK);
    const conn = tx as unknown as AppDb;
    const prevHash = input.prevHash ?? (await getLatestAuditHash(conn));
    const record = appendAuditRecord({ ...input, prevHash });
    await appendAuditRecordRow(conn, record);
    return record;
  });
}

function rowToCard(row: typeof approvalCards.$inferSelect): ApprovalCard {
  const grant = reviveGrant(row.grantSnapshot);
  const decision = row.decision as Decision | null;
  const attrRaw = row.attribution as ApprovalCard["attribution"] & {
    protected?: boolean;
    protectedReason?: string;
    autoApprovedBy?: string;
  };
  const { protected: isProtected, protectedReason, autoApprovedBy, ...attribution } = attrRaw;
  return {
    id: asApprovalCardId(row.id),
    grant,
    proposedAction: row.proposedAction as ApprovalCard["proposedAction"],
    irreversible: row.irreversible,
    risk: row.risk as ApprovalCard["risk"],
    attribution,
    status: row.status as ApprovalStatus,
    ...(decision
      ? {
          decision: {
            ...decision,
            at: new Date(decision.at),
          },
        }
      : {}),
    ...(isProtected ? { protected: true, protectedReason } : {}),
    ...(autoApprovedBy ? { autoApprovedBy } : {}),
  };
}

function rowToAudit(row: typeof auditRecords.$inferSelect): AuditRecord {
  return {
    id: row.id as AuditRecord["id"],
    cardId: asApprovalCardId(row.cardId),
    action: row.action as AuditRecord["action"],
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    executedAt: row.executedAt,
    result: row.result as AuditRecord["result"],
    ...(row.error ? { error: row.error } : {}),
    evidenceSnapshot: row.evidenceSnapshot as AuditRecord["evidenceSnapshot"],
    prevHash: asHashHex(row.prevHash),
    hash: asHashHex(row.hash),
  };
}

function reviveGrant(raw: unknown): Grant {
  const g = raw as Grant & {
    discoveredAt: string | Date;
    createdAt?: string | Date;
    lastUsedAt?: string | Date;
  };
  return {
    ...g,
    discoveredAt: new Date(g.discoveredAt),
    ...(g.createdAt ? { createdAt: new Date(g.createdAt) } : {}),
    ...(g.lastUsedAt ? { lastUsedAt: new Date(g.lastUsedAt) } : {}),
  };
}

export { sql };
