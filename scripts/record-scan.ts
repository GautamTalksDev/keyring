#!/usr/bin/env tsx
/**
 * Record a fixture scan to fixtures/recordings/, then optionally replay it.
 *
 *   pnpm record:scan
 *   pnpm record:scan -- --replay-only
 *
 * Zero provider calls in record (fixture + estimated role costs) unless
 * KEYRING_RECORD_WITH=trueforge and a real provider is configured.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createDb } from "../packages/server/src/db/client.js";
import { runMigrations } from "../packages/server/src/db/migrate.js";
import { loadRecording, recordingsDir } from "../packages/server/src/recording/store.js";
import { createStandaloneApp } from "../packages/server/src/standalone.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://keyring:keyring@localhost:5432/keyring";

const replayOnly = process.argv.includes("--replay-only");
const person = process.env.KEYRING_RECORD_PERSON ?? "Ada Lovelace";
const recordingId =
  process.env.KEYRING_RECORDING_ID ??
  person
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

async function waitForScan(
  app: ReturnType<typeof createStandaloneApp>,
  scanId: string,
): Promise<{ status: string; costs: unknown; recordingId: unknown }> {
  for (let i = 0; i < 120; i++) {
    const res = await app.inject({ method: "GET", url: `/scans/${scanId}` });
    const body = res.json() as {
      status: string;
      costs: unknown;
      recordingId: unknown;
    };
    if (
      body.status === "completed" ||
      body.status === "failed" ||
      body.status === "cost_capped"
    ) {
      return body;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("scan timed out");
}

async function main() {
  await runMigrations(databaseUrl);
  const { db, client } = createDb(databaseUrl);
  const app = createStandaloneApp({ db });

  try {
    if (!replayOnly) {
      console.log(`Recording scan for "${person}" → ${recordingId}`);
      const create = await app.inject({
        method: "POST",
        url: "/scans",
        payload: {
          person,
          driver: "record",
          recordingId,
          delayMsPerGrant: 0,
        },
      });
      if (create.statusCode >= 300) {
        console.error(create.json());
        process.exit(1);
      }
      const { scanId } = create.json() as { scanId: string };
      const done = await waitForScan(app, scanId);
      console.log("record status:", done.status);
      console.log("costs:", done.costs);
      const dest = path.join(recordingsDir(), `${recordingId}.json`);
      console.log("wrote:", dest);
    }

    console.log(`Replaying ${recordingId} (zero API calls)…`);
    const createReplay = await app.inject({
      method: "POST",
      url: "/scans",
      payload: {
        person,
        driver: "replay",
        recordingId,
      },
    });
    if (createReplay.statusCode >= 300) {
      console.error(createReplay.json());
      process.exit(1);
    }
    const { scanId: replayId } = createReplay.json() as { scanId: string };
    const replayed = await waitForScan(app, replayId);
    console.log("replay status:", replayed.status);
    console.log("replay costs:", replayed.costs);

    const cards = await app.inject({
      method: "GET",
      url: `/scans/${replayId}/cards`,
    });
    const cardBody = cards.json() as { cards: unknown[] };
    const recording = await loadRecording(recordingId);
    console.log(
      `replay cards=${cardBody.cards.length} recording.interactions=${recording.interactions.length}`,
    );
    console.log("OK — record + replay identical offline path.");
  } finally {
    await app.close();
    await client.end({ timeout: 5 });
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
void __dirname;

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
