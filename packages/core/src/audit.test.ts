import { describe, expect, it } from "vitest";

import {
  GENESIS_HASH,
  appendAuditRecord,
  computeAuditHash,
  parseAuditExport,
  verifyAuditChain,
} from "./audit.js";
import { asApprovalCardId } from "./brand.js";
import type { NonEmptyEvidence } from "./evidence.js";

const evidence: NonEmptyEvidence = [
  {
    claim: "revocation executed via API",
    source: "github",
    confidence: "certain",
  },
];

const cardId = asApprovalCardId("card-1");

function record(prevHash: typeof GENESIS_HASH, action: "approve" | "execute_revoke" = "approve") {
  return appendAuditRecord({
    cardId,
    action,
    approvedBy: "auditor@acme.com",
    approvedAt: new Date("2026-06-01T12:00:00.000Z"),
    executedAt: new Date("2026-06-01T12:01:00.000Z"),
    result: "success",
    evidenceSnapshot: evidence,
    prevHash,
  });
}

describe("audit hash chain", () => {
  it("uses genesis hash for the first record", () => {
    const first = record(GENESIS_HASH);
    expect(first.prevHash).toBe(GENESIS_HASH);
    const { hash: _ignored, ...body } = first;
    expect(first.hash).toBe(computeAuditHash(body));
  });

  it("links each record to the previous hash", () => {
    const first = record(GENESIS_HASH);
    const second = record(first.hash, "execute_revoke");
    expect(second.prevHash).toBe(first.hash);
    expect(second.hash).not.toBe(first.hash);
  });

  it("verifies a valid chain", () => {
    const first = record(GENESIS_HASH);
    const second = record(first.hash, "execute_revoke");
    expect(verifyAuditChain([first, second])).toEqual({ ok: true });
  });

  it("accepts an empty chain", () => {
    expect(verifyAuditChain([])).toEqual({ ok: true });
  });

  it("detects a tampered payload (hash mismatch)", () => {
    const first = record(GENESIS_HASH);
    const tampered = { ...first, approvedBy: "attacker@evil.com" };
    const result = verifyAuditChain([tampered]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.index).toBe(0);
      expect(result.reason).toMatch(/hash mismatch/);
    }
  });

  it("detects a broken prevHash link", () => {
    const first = record(GENESIS_HASH);
    const second = record(first.hash, "execute_revoke");
    const broken = { ...second, prevHash: GENESIS_HASH };
    const result = verifyAuditChain([first, broken]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.index).toBe(1);
      expect(result.reason).toMatch(/prevHash mismatch/);
    }
  });

  it("detects forged hash that does not match content", () => {
    const first = record(GENESIS_HASH);
    const forged = {
      ...first,
      hash: first.hash.replace(/^./, (c) => (c === "a" ? "b" : "a")) as typeof first.hash,
    };
    // ensure we actually changed it
    expect(forged.hash).not.toBe(first.hash);
    const result = verifyAuditChain([forged]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/hash mismatch/);
    }
  });

  it("is deterministic for identical inputs", () => {
    const a = record(GENESIS_HASH);
    const b = record(GENESIS_HASH);
    expect(a.hash).toBe(b.hash);
    expect(a.id).toBe(b.id);
  });

  it("changes hash when evidence snapshot changes", () => {
    const a = appendAuditRecord({
      cardId,
      action: "approve",
      approvedBy: "auditor@acme.com",
      approvedAt: new Date("2026-06-01T12:00:00.000Z"),
      executedAt: new Date("2026-06-01T12:01:00.000Z"),
      result: "success",
      evidenceSnapshot: evidence,
      prevHash: GENESIS_HASH,
    });
    const b = appendAuditRecord({
      cardId,
      action: "approve",
      approvedBy: "auditor@acme.com",
      approvedAt: new Date("2026-06-01T12:00:00.000Z"),
      executedAt: new Date("2026-06-01T12:01:00.000Z"),
      result: "success",
      evidenceSnapshot: [
        {
          claim: "different claim",
          source: "github",
          confidence: "probable",
        },
      ],
      prevHash: GENESIS_HASH,
    });
    expect(a.hash).not.toBe(b.hash);
  });

  it("round-trips export JSON via parseAuditExport", () => {
    const first = record(GENESIS_HASH);
    const second = record(first.hash, "execute_revoke");
    const payload = {
      exportedAt: new Date().toISOString(),
      records: [first, second].map((r) => ({
        ...r,
        approvedAt: r.approvedAt.toISOString(),
        executedAt: r.executedAt.toISOString(),
        error: r.error ?? null,
      })),
    };
    const revived = parseAuditExport(payload);
    expect(verifyAuditChain(revived.records)).toEqual({ ok: true });
  });
});
