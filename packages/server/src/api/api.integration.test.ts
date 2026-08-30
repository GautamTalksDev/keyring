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
  await db.execute(sql`ALTER TABLE audit_records DISABLE TRIGGER audit_records_append_only`);
  await db.execute(sql`TRUNCATE TABLE audit_records`);
  await db.execute(sql`ALTER TABLE audit_records ENABLE TRIGGER audit_records_append_only`);
}

describe("API scan → approve → execute → audit (fixture)", () => {
  let db: AppDb;
  let close: () => Promise<void>;
  let app: ReturnType<typeof createApp>;
  const previousDemo = process.env.KEYRING_DEMO;

  beforeAll(async () => {
    process.env.KEYRING_DEMO = "1";
    const handle = await openTestDatabase("api");
    db = handle.db;
    close = handle.close;
    app = createApp(Fastify({ logger: false }), { db });
    await resetAuditLedger(db);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await close();
    if (previousDemo === undefined) delete process.env.KEYRING_DEMO;
    else process.env.KEYRING_DEMO = previousDemo;
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

    const reset = await app.inject({
      method: "POST",
      url: `/scans/${scanId}/demo-reset`,
    });
    expect(reset.statusCode).toBe(200);
    expect((reset.json() as { reset: number }).reset).toBeGreaterThan(0);

    const resetCards = await app.inject({
      method: "GET",
      url: `/scans/${scanId}/cards`,
    });
    const resetCardData = resetCards.json() as {
      cards: Array<{ status: string; decision: unknown }>;
    };
    expect(resetCardData.cards.every((card) => card.status === "pending")).toBe(true);
    expect(resetCardData.cards.every((card) => card.decision === null)).toBe(true);

    const audit = await app.inject({ method: "GET", url: "/audit" });
    const auditData = audit.json() as { records: unknown[]; verification: { ok: boolean } };
    expect(auditData.records.length).toBeGreaterThan(0);
    expect(auditData.verification.ok).toBe(true);
  }, 60_000);

  it("fails closed when audit export signing is not configured", async () => {
    const previousSecret = process.env.KEYRING_EXPORT_SECRET;
    delete process.env.KEYRING_EXPORT_SECRET;
    try {
      const response = await app.inject({
        method: "GET",
        url: "/audit/export?format=json",
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        error: "export_signing_unavailable",
      });
      expect(response.json().message).toContain("KEYRING_EXPORT_SECRET");
    } finally {
      if (previousSecret === undefined) delete process.env.KEYRING_EXPORT_SECRET;
      else process.env.KEYRING_EXPORT_SECRET = previousSecret;
    }
  });

  it("signs audit exports with configured key material", async () => {
    const previousSecret = process.env.KEYRING_EXPORT_SECRET;
    process.env.KEYRING_EXPORT_SECRET = "integration-test-export-secret";
    try {
      const response = await app.inject({
        method: "GET",
        url: "/audit/export?format=json",
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["x-keyring-signature"]).toBeTruthy();
      expect(response.headers["x-keyring-signature-alg"]).toBe("hmac-sha256");
    } finally {
      if (previousSecret === undefined) delete process.env.KEYRING_EXPORT_SECRET;
      else process.env.KEYRING_EXPORT_SECRET = previousSecret;
    }
  });

  it("keeps every approval card in a non-demo scan", async () => {
    const previousDemo = process.env.KEYRING_DEMO;
    delete process.env.KEYRING_DEMO;
    try {
      const create = await app.inject({
        method: "POST",
        url: "/scans",
        payload: { scope: "all", driver: "fixture", delayMsPerGrant: 0 },
      });
      expect(create.statusCode).toBe(202);
      const { scanId } = create.json() as { scanId: string };

      for (let i = 0; i < 80; i++) {
        const status = await app.inject({ method: "GET", url: `/scans/${scanId}` });
        const value = status.json() as { status: string };
        if (
          value.status === "completed" ||
          value.status === "failed" ||
          value.status === "cost_capped" ||
          value.status === "partial"
        ) {
          expect(value.status).toBe("completed");
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const cardsResponse = await app.inject({
        method: "GET",
        url: `/scans/${scanId}/cards`,
      });
      expect(cardsResponse.statusCode).toBe(200);
      const cards = cardsResponse.json() as {
        cards: unknown[];
        counts: { cardCount: number };
      };
      expect(cards.cards.length).toBeGreaterThan(9);
      expect(cards.counts.cardCount).toBe(cards.cards.length);
    } finally {
      if (previousDemo === undefined) delete process.env.KEYRING_DEMO;
      else process.env.KEYRING_DEMO = previousDemo;
    }
  }, 60_000);
});
