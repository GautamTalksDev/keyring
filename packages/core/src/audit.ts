import {
  asApprovalCardId,
  asAuditRecordId,
  asHashHex,
  type ApprovalCardId,
  type AuditRecordId,
  type HashHex,
} from "./brand.js";
import type { NonEmptyEvidence } from "./evidence.js";
import { canonicalJson, sha256Hex } from "./hash.js";

export type AuditAction =
  | "approve"
  | "reject"
  | "hold"
  | "execute_revoke"
  | "execute_downgrade"
  | "execute_transfer"
  | "flag";

export type AuditResult = "success" | "failed" | "partial";

/**
 * Append-only ledger entry. Hash-chained for tamper evidence.
 */
export interface AuditRecord {
  id: AuditRecordId;
  cardId: ApprovalCardId;
  action: AuditAction;
  approvedBy: string;
  approvedAt: Date;
  executedAt: Date;
  result: AuditResult;
  error?: string;
  evidenceSnapshot: NonEmptyEvidence;
  prevHash: HashHex;
  hash: HashHex;
}

/** Genesis prevHash for the first record in a chain. */
export const GENESIS_HASH: HashHex = asHashHex("0".repeat(64));

export interface AuditRecordInput {
  id?: AuditRecordId | string;
  cardId: ApprovalCardId;
  action: AuditAction;
  approvedBy: string;
  approvedAt: Date;
  executedAt: Date;
  result: AuditResult;
  error?: string;
  evidenceSnapshot: NonEmptyEvidence;
  prevHash: HashHex;
}

function payloadForHash(
  record: Omit<AuditRecord, "hash">,
): Record<string, unknown> {
  return {
    id: record.id,
    cardId: record.cardId,
    action: record.action,
    approvedBy: record.approvedBy,
    approvedAt: record.approvedAt.toISOString(),
    executedAt: record.executedAt.toISOString(),
    result: record.result,
    error: record.error ?? null,
    evidenceSnapshot: record.evidenceSnapshot,
    prevHash: record.prevHash,
  };
}

/**
 * Compute the hash for an audit record body (including prevHash).
 */
export function computeAuditHash(record: Omit<AuditRecord, "hash">): HashHex {
  return sha256Hex(canonicalJson(payloadForHash(record)));
}

/**
 * Append a record to the chain. `prevHash` must be the previous record's hash
 * (or GENESIS_HASH for the first entry).
 */
export function appendAuditRecord(input: AuditRecordInput): AuditRecord {
  const id =
    typeof input.id === "string" && input.id.length > 0
      ? asAuditRecordId(input.id)
      : asAuditRecordId(
          sha256Hex(
            `${input.cardId}\0${input.action}\0${input.approvedAt.toISOString()}\0${input.prevHash}`,
          ),
        );

  const withoutHash: Omit<AuditRecord, "hash"> = {
    id,
    cardId: input.cardId,
    action: input.action,
    approvedBy: input.approvedBy,
    approvedAt: input.approvedAt,
    executedAt: input.executedAt,
    result: input.result,
    ...(input.error !== undefined ? { error: input.error } : {}),
    evidenceSnapshot: input.evidenceSnapshot,
    prevHash: input.prevHash,
  };

  return {
    ...withoutHash,
    hash: computeAuditHash(withoutHash),
  };
}

export type ChainVerification =
  | { ok: true }
  | { ok: false; index: number; reason: string };

/**
 * Verify an ordered hash chain. Empty chain is valid.
 */
export function verifyAuditChain(
  records: readonly AuditRecord[],
): ChainVerification {
  let expectedPrev: HashHex = GENESIS_HASH;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) {
      return { ok: false, index: i, reason: "missing record" };
    }

    if (record.prevHash !== expectedPrev) {
      return {
        ok: false,
        index: i,
        reason: `prevHash mismatch: expected ${expectedPrev}, got ${record.prevHash}`,
      };
    }

    const expectedHash = computeAuditHash({
      id: record.id,
      cardId: record.cardId,
      action: record.action,
      approvedBy: record.approvedBy,
      approvedAt: record.approvedAt,
      executedAt: record.executedAt,
      result: record.result,
      ...(record.error !== undefined ? { error: record.error } : {}),
      evidenceSnapshot: record.evidenceSnapshot,
      prevHash: record.prevHash,
    });

    if (record.hash !== expectedHash) {
      return {
        ok: false,
        index: i,
        reason: `hash mismatch: expected ${expectedHash}, got ${record.hash}`,
      };
    }

    expectedPrev = record.hash;
  }

  return { ok: true };
}

/**
 * Revive audit records from a JSON export (ISO date strings → Date).
 * Third parties use this with {@link verifyAuditChain}.
 */
export function reviveAuditRecords(
  raw: readonly Record<string, unknown>[],
): AuditRecord[] {
  return raw.map((r, index) => {
    const id = String(r.id ?? "");
    const cardId = String(r.cardId ?? "");
    const action = r.action as AuditAction;
    const approvedBy = String(r.approvedBy ?? "");
    const result = r.result as AuditResult;
    const prevHash = asHashHex(String(r.prevHash ?? ""));
    const hash = asHashHex(String(r.hash ?? ""));
    const evidenceSnapshot = r.evidenceSnapshot as AuditRecord["evidenceSnapshot"];
    if (!id || !cardId || !action || !result || !evidenceSnapshot) {
      throw new Error(`invalid audit record at index ${index}`);
    }
    return {
      id: asAuditRecordId(id),
      cardId: asApprovalCardId(cardId),
      action,
      approvedBy,
      approvedAt: new Date(String(r.approvedAt)),
      executedAt: new Date(String(r.executedAt)),
      result,
      ...(typeof r.error === "string" && r.error.length > 0
        ? { error: r.error }
        : {}),
      evidenceSnapshot,
      prevHash,
      hash,
    };
  });
}

/**
 * Parse a Keyring audit JSON export body (file or HTTP response).
 */
export function parseAuditExport(payload: unknown): {
  records: AuditRecord[];
  verification?: ChainVerification & { count?: number };
} {
  if (payload === null || typeof payload !== "object") {
    throw new Error("audit export must be a JSON object");
  }
  const body = payload as {
    records?: unknown;
    verification?: ChainVerification & { count?: number };
  };
  if (!Array.isArray(body.records)) {
    throw new Error("audit export missing records[]");
  }
  return {
    records: reviveAuditRecords(body.records as Record<string, unknown>[]),
    ...(body.verification ? { verification: body.verification } : {}),
  };
}

