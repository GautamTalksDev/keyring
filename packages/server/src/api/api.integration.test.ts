/**
 * Full product path against FixtureConnector:
 * scan → cards → decision (intent) → execute → audit chain verifies.
 */
import Fastify from "fastify";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import type { AppDb } from "../db/client.js";
import { openTestDatabase } from "../db/test-db.js";
import { verifyStoredAuditChain } from "../db/store.js";

/** Reset append-only ledger for a clean chain (test-only). */
async function resetAuditLedger(db: AppDb): Promise<void> {
  await db.execute(
    sql`ALTER TABLE audit_records DISABLE TRIGGER audit_records_append_only`,
  );
  await db.execute(sql`TRUNCATE TABLE audit_records`);
  await db.execute(
    sql`ALTER TABLE audit_records ENABLE TRIGGER audit_records_append_only`,
  );
}

describe("API scan → approve → execute → audit (fixture)", () => {
  let db: AppDb;
  let close: () => Promise<void>;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    const handle = await openTestDatabase("api");
    db = handle.db;
    close = handle.close;
    app = createApp(Fastify({ logger: false }), { db });
    await resetAuditLedger(db);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await close();
  });

  it("runs the full path and verifies the hash chain", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/scans",
      payload: {
        person: "Ada Lovelace",
        driver: "fixture",
        delayMsPerGrant: 0,
      },
    });
    expect(create.statusCode).toBe(202);
    const { scanId } = create.json() as { scanId: string };

    let status = "running";
    for (let i = 0; i < 80; i++) {
      const res = await app.inject({ method: "GET", url: `/scans/${scanId}` });
      status = (res.json() as { status: string }).status;
      if (
        status === "completed" ||
        status === "failed" ||
        status === "cost_capped" ||
        status === "partial"
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(status).toBe("completed");

    const cardsRes = await app.inject({
      method: "GET",
      url: `/scans/${scanId}/cards`,
    });
    expect(cardsRes.statusCode).toBe(200);
    const { cards } = cardsRes.json() as {
      cards: Array<{ id: string; status: string; proposedAction: { kind: string } }>;
    };
    expect(cards.length).toBeGreaterThan(0);

    const approvable = cards.filter(
      (c) => c.status === "pending" && c.proposedAction.kind !== "flag_only",
    );
    expect(approvable.length).toBeGreaterThan(0);

    for (const card of approvable.slice(0, 3)) {
      const dec = await app.inject({
        method: "POST",
        url: `/cards/${card.id}/decision`,
        payload: { decision: "approve", by: "judge@example.com" },
      });
      expect(dec.statusCode).toBe(200);
    }

    const exec = await app.inject({
      method: "POST",
      url: `/scans/${scanId}/execute`,
      payload: { approvedBy: "judge@example.com", dryRun: true },
    });
    expect(exec.statusCode).toBe(200);
    const summary = exec.json() as {
      dryRun: boolean;
      executed: number;
      failed: number;
    };
    expect(summary.dryRun).toBe(true);
    expect(summary.executed).toBeGreaterThan(0);

    const chain = await verifyStoredAuditChain(db);
    expect(chain.ok).toBe(true);
  }, 60_000);
});
