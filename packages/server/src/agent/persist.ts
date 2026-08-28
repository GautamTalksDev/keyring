import {
  appendAuditRecord,
  GENESIS_HASH,
  type ApprovalCard,
  type AuditRecord,
  type Grant,
  type ReconciliationResult,
} from "@keyring/core";
import { randomUUID } from "node:crypto";

import type { Database } from "../db/client.js";
import {
  createScanRun,
  finishScanRun,
  insertApprovalCard,
  upsertGrant,
} from "../db/store.js";

export interface PersistScanInput {
  grants: Grant[];
  cards: ApprovalCard[];
  reconciliation: ReconciliationResult;
  /** Optional person / prompt hint stored on the scan run. */
  hint?: string;
}

export interface PersistScanResult {
  scanRunId: string;
  grantsUpserted: number;
  cardsInserted: number;
  clusterCount: number;
  unknownCount: number;
}

/**
 * Persist merged grants + ApprovalCards after reconciliation.
 * No revoke — scan path stops here.
 */
export async function persistScanOutcome(
  db: Database["db"] | null,
  input: PersistScanInput,
): Promise<PersistScanResult> {
  const scanRunId = randomUUID();
  const clusterCount = input.reconciliation.clusters.length;
  const unknownCount = input.reconciliation.unknown.grantIds.length;

  if (!db) {
    return {
      scanRunId,
      grantsUpserted: input.grants.length,
      cardsInserted: input.cards.length,
      clusterCount,
      unknownCount,
    };
  }

  await createScanRun(db, {
    id: scanRunId,
    connectorId: "fixture-fanout",
    status: "running",
    metadata: {
      hint: input.hint ?? null,
      clusters: clusterCount,
      unknown: unknownCount,
    },
  });

  try {
    for (const grant of input.grants) {
      await upsertGrant(db, grant);
    }
    for (const card of input.cards) {
      await insertApprovalCard(db, card).catch(() => {
        // Idempotent-ish: skip duplicate card ids on re-scan
      });
    }
    await finishScanRun(db, {
      id: scanRunId,
      status: "completed",
      grantsDiscovered: input.grants.length,
    });
  } catch (err) {
    await finishScanRun(db, {
      id: scanRunId,
      status: "failed",
      grantsDiscovered: 0,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  return {
    scanRunId,
    grantsUpserted: input.grants.length,
    cardsInserted: input.cards.length,
    clusterCount,
    unknownCount,
  };
}

/** Record a post-approval revoke in the append-only audit ledger. */
export function buildRevokeAuditRecord(input: {
  card: ApprovalCard;
  approvedBy: string;
  result: "success" | "failed";
  error?: string;
  prevHash?: typeof GENESIS_HASH;
}): AuditRecord {
  return appendAuditRecord({
    cardId: input.card.id,
    action: "execute_revoke",
    approvedBy: input.approvedBy,
    approvedAt: new Date(),
    executedAt: new Date(),
    result: input.result,
    error: input.error,
    evidenceSnapshot: input.card.grant.evidence,
    prevHash: input.prevHash ?? GENESIS_HASH,
  });
}
