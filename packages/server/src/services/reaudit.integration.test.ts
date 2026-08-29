import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import type { AppDb } from "../db/client.js";
import { openTestDatabase } from "../db/test-db.js";

describe("re-audit integration", () => {
  let db: AppDb;
  let close: () => Promise<void>;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    const handle = await openTestDatabase("reaudit");
    db = handle.db;
    close = handle.close;
    app = createApp(Fastify({ logger: false }), { db });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await close();
  });

  it("uses the completed PGlite-backed scan as the diff baseline", async () => {
    const baselineId = await startFixtureScan();
    expect(await waitForScan(baselineId)).toBe("completed");

    const reaudit = await app.inject({
      method: "POST",
      url: "/scans",
      payload: {
        person: "Ada Lovelace",
        driver: "fixture",
        reaudit: true,
        diffOnly: true,
        delayMsPerGrant: 0,
      },
    });
    expect(reaudit.statusCode).toBe(202);
    const { scanId } = reaudit.json() as { scanId: string };
    expect(await waitForScan(scanId)).toBe("completed");

    const cardsResponse = await app.inject({
      method: "GET",
      url: `/scans/${scanId}/cards`,
    });
    expect(cardsResponse.statusCode).toBe(200);
    const body = cardsResponse.json() as {
      cards: Array<{ status: string; protected: boolean }>;
    };
    expect(body.cards.length).toBeGreaterThan(0);
    expect(
      body.cards.every((card) => card.protected || card.status === "held"),
    ).toBe(true);
  }, 60_000);

  async function startFixtureScan(): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/scans",
      payload: {
        person: "Ada Lovelace",
        driver: "fixture",
        delayMsPerGrant: 0,
      },
    });
    expect(response.statusCode).toBe(202);
    return (response.json() as { scanId: string }).scanId;
  }

  async function waitForScan(scanId: string): Promise<string> {
    for (let i = 0; i < 80; i++) {
      const response = await app.inject({
        method: "GET",
        url: `/scans/${scanId}`,
      });
      const status = (response.json() as { status: string }).status;
      if (
        status === "completed" ||
        status === "failed" ||
        status === "cost_capped" ||
        status === "partial"
      ) {
        return status;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("scan timed out");
  }
});
