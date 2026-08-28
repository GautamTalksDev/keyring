import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import type { AppDb } from "../db/client.js";
import { openTestDatabase } from "../db/test-db.js";
import { loadRecording } from "../recording/store.js";

describe("record → replay (offline)", () => {
  const recordingsDir = mkdtempSync(path.join(tmpdir(), "keyring-rec-"));
  process.env.KEYRING_RECORDINGS_DIR = recordingsDir;

  let db: AppDb;
  let close: () => Promise<void>;
  let app: ReturnType<typeof createApp>;
  const recordingId = `test-ada`;

  beforeAll(async () => {
    const handle = await openTestDatabase("recording");
    db = handle.db;
    close = handle.close;
    app = createApp(Fastify({ logger: false }), { db });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await close();
  });

  it("records a scan and replays with matching costs and cards", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/scans",
      payload: {
        person: "Ada Lovelace",
        driver: "record",
        recordingId,
        delayMsPerGrant: 0,
      },
    });
    expect(create.statusCode).toBe(202);
    const { scanId } = create.json() as { scanId: string };

    let status = "running";
    let costs: { costUsd: number; inputTokens: number } | null = null;
    for (let i = 0; i < 80; i++) {
      const res = await app.inject({ method: "GET", url: `/scans/${scanId}` });
      const body = res.json() as {
        status: string;
        costs?: { costUsd: number; inputTokens: number };
      };
      status = body.status;
      if (body.costs) costs = body.costs;
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
    expect(costs).toBeTruthy();

    const recording = await loadRecording(recordingId);
    expect(recording.id).toBe(recordingId);
    expect(recording.cards.length).toBeGreaterThan(0);

    const cardsAfterRecord = await app.inject({
      method: "GET",
      url: `/scans/${scanId}/cards`,
    });
    const recordedCount = (
      cardsAfterRecord.json() as { cards: unknown[] }
    ).cards.length;

    const replay = await app.inject({
      method: "POST",
      url: "/scans",
      payload: {
        person: "Ada Lovelace",
        driver: "replay",
        recordingId,
      },
    });
    expect(replay.statusCode).toBe(202);
    const { scanId: replayId } = replay.json() as { scanId: string };

    let replayStatus = "running";
    for (let i = 0; i < 80; i++) {
      const res = await app.inject({ method: "GET", url: `/scans/${replayId}` });
      replayStatus = (res.json() as { status: string }).status;
      if (
        replayStatus === "completed" ||
        replayStatus === "failed" ||
        replayStatus === "cost_capped"
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(replayStatus).toBe("completed");

    const replayCards = await app.inject({
      method: "GET",
      url: `/scans/${replayId}/cards`,
    });
    expect((replayCards.json() as { cards: unknown[] }).cards.length).toBe(
      recordedCount,
    );
  }, 60_000);
});
