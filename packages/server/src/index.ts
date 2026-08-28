import Fastify from "fastify";

import { createApp } from "./app.js";
import { openDatabase, usePgliteMode } from "./db/client.js";
import { startReauditScheduler } from "./services/reaudit-cron.js";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

let db = null as Awaited<ReturnType<typeof openDatabase>>["db"] | null;
const shouldOpenDb =
  Boolean(process.env.DATABASE_URL) ||
  usePgliteMode() ||
  process.env.KEYRING_DEMO === "1";

if (shouldOpenDb) {
  try {
    const handle = await openDatabase();
    db = handle.db;
    console.log(`Database: ${handle.kind}`);
  } catch (err) {
    console.warn("DB open failed; product API disabled", err);
  }
} else {
  console.warn(
    "DATABASE_URL unset — product API (/scans, /audit) disabled (set KEYRING_DEMO=1 for embedded PGlite)",
  );
}

const app = createApp(
  Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  }),
  { db },
);

await app.listen({ port, host });
console.log(`Keyring server listening on http://${host}:${port}`);
console.log(`  MCP scan:   http://${host}:${port}/mcp/scan`);
console.log(`  MCP mutate: http://${host}:${port}/mcp/mutate`);
if (db) {
  console.log(`  API:        POST /scans  GET /audit  …`);
  await startReauditScheduler(db, app.log);
}
