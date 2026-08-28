import {
  appendAuditRecord,
  asApprovalCardId,
} from "@keyring/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppDb } from "./client.js";
import { auditRecords } from "./schema.js";
import { getLatestAuditHash } from "./store.js";
import { openTestDatabase } from "./test-db.js";

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
      evidenceSnapshot: [
        {
          claim: "integration test insert",
          source: "test",
          confidence: "certain",
        },
      ],
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
});
