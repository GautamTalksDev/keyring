import {
  appendAuditRecord,
  asApprovalCardId,
} from "@keyring/core";
import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppDb } from "./client.js";
import { auditRecords } from "./schema.js";
import {
  appendChainedAudit,
  getLatestAuditHash,
  verifyStoredAuditChain,
} from "./store.js";
import { openTestDatabase } from "./test-db.js";

const evidence = [
  {
    claim: "integration test insert",
    source: "test",
    confidence: "certain" as const,
  },
];

describe("audit_records append-only", () => {
  let db: AppDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const handle = await openTestDatabase("audit");
    db = handle.db;
    close = handle.close;
  }, 60_000);

  afterAll(async () => {
    await close();
  });

  it("applies migrations and rejects UPDATE at the database level", async () => {
    const prevHash = await getLatestAuditHash(db);

    const record = appendAuditRecord({
      id: `audit-${crypto.randomUUID()}`,
      cardId: asApprovalCardId(`card-${crypto.randomUUID()}`),
      action: "approve",
      approvedBy: "judge@acme.com",
      approvedAt: new Date(),
      executedAt: new Date(),
      result: "success",
      evidenceSnapshot: evidence,
      prevHash,
    });

    await db.insert(auditRecords).values({
      id: record.id,
      cardId: record.cardId,
      action: record.action,
      approvedBy: record.approvedBy,
      approvedAt: record.approvedAt,
      executedAt: record.executedAt,
      result: record.result,
      error: record.error ?? null,
      evidenceSnapshot: record.evidenceSnapshot,
      prevHash: record.prevHash,
      hash: record.hash,
    });

    await expect(
      db
        .update(auditRecords)
        .set({ result: "failed" })
        .where(sql`id = ${record.id}`),
    ).rejects.toThrow(/append-only/i);
  });

  it("keeps a valid chain across rapid sequential appends", async () => {
    const before = await verifyStoredAuditChain(db);
    for (let i = 0; i < 20; i++) {
      await appendChainedAudit(db, {
        cardId: asApprovalCardId(`card-seq-${i}-${crypto.randomUUID()}`),
        action: "approve",
        approvedBy: "judge@acme.com",
        approvedAt: new Date(),
        executedAt: new Date(),
        result: "success",
        evidenceSnapshot: evidence,
      });
    }
    const after = await verifyStoredAuditChain(db);
    expect(after.ok).toBe(true);
    expect(after.count).toBe(before.count + 20);
  });

  it("keeps a valid chain when appends race", async () => {
    const before = await verifyStoredAuditChain(db);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        appendChainedAudit(db, {
          cardId: asApprovalCardId(`card-race-${i}-${crypto.randomUUID()}`),
          action: "approve",
          approvedBy: "judge@acme.com",
          approvedAt: new Date(),
          executedAt: new Date(),
          result: "success",
          evidenceSnapshot: evidence,
        }),
      ),
    );
    const after = await verifyStoredAuditChain(db);
    expect(after.ok).toBe(true);
    expect(after.count).toBe(before.count + 10);
  });

  it("prevents forks when concurrent appends share an identical recorded_at", async () => {
    const recordedAt = "2026-08-29T23:00:00.000Z";
    await db.execute(
      sql`ALTER TABLE audit_records ALTER COLUMN recorded_at SET DEFAULT '2026-08-29T23:00:00.000Z'::timestamptz`,
    );

    const appended = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        appendChainedAudit(db, {
          cardId: asApprovalCardId(
            `card-identical-recorded-at-${i}-${crypto.randomUUID()}`,
          ),
          action: "approve",
          approvedBy: "judge@acme.com",
          approvedAt: new Date(recordedAt),
          executedAt: new Date(recordedAt),
          result: "success",
          evidenceSnapshot: evidence,
        }),
      ),
    );

    const appendedRows = await db
      .select({
        id: auditRecords.id,
        recordedAt: auditRecords.recordedAt,
      })
      .from(auditRecords)
      .where(
        inArray(
          auditRecords.id,
          appended.map((record) => record.id),
        ),
      );
    expect(new Set(appendedRows.map((row) => row.recordedAt.toISOString())).size).toBe(
      1,
    );

    const allRows = await db
      .select({ prevHash: auditRecords.prevHash })
      .from(auditRecords);
    const prevHashes = allRows.map((row) => row.prevHash);
    expect(new Set(prevHashes).size).toBe(prevHashes.length);
    expect((await verifyStoredAuditChain(db)).ok).toBe(true);
  });
});
