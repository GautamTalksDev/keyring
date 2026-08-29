import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import type { AppDb } from "../db/client.js";
import { openTestDatabase } from "../db/test-db.js";

const CI_KEY = "AKIA_KEYRING_CI_ORPHAN_LOOKALIKE";

describe("policy integration", () => {
  let db: AppDb;
  let close: () => Promise<void>;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    const handle = await openTestDatabase("policy");
    db = handle.db;
    close = handle.close;
    app = createApp(Fastify({ logger: false }), { db });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await close();
  });

  it("loads keyring.yml policy into persisted approval cards", async () => {
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

    const status = await waitForScan(scanId);
    expect(status).toBe("completed");

    const cardsResponse = await app.inject({
      method: "GET",
      url: `/scans/${scanId}/cards`,
    });
    expect(cardsResponse.statusCode).toBe(200);
    const { cards } = cardsResponse.json() as {
      cards: Array<{
        status: string;
        protected: boolean;
        attribution: { resolvedTo?: string };
        grant: {
          system: string;
          resource: { id: string };
          principal: {
            identifiers: Array<{ value: string }>;
          };
        };
      }>;
    };

    const ciCard = cards.find(
      (card) =>
        card.grant.system === "github" &&
        card.grant.resource.id === "keyring-test/payments" &&
        card.grant.principal.identifiers.some(
          (identifier) => identifier.value === CI_KEY,
        ),
    );
    expect(ciCard).toBeDefined();
    expect(ciCard?.attribution.resolvedTo).toBeTruthy();
    expect(ciCard?.status).toBe("held");
    expect(ciCard?.protected).toBe(true);
  }, 60_000);

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
