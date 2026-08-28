/**
 * Judge-facing one-command demo: embedded PGlite, seeded recording replay,
 * no API credentials. Starts API + UI.
 *
 * Usage: pnpm demo
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runMigrations } from "../packages/server/src/db/client.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const recording = path.join(root, "fixtures/recordings/ada-lovelace.json");
const pglitePath = path.join(root, ".keyring-pglite-demo");

const children: ChildProcess[] = [];

function die(msg: string, code = 1): never {
  console.error(`\n[demo] ${msg}`);
  for (const c of children) c.kill("SIGTERM");
  process.exit(code);
}

function waitHealth(url: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve();
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`timeout waiting for ${url}`));
          return;
        }
        setTimeout(tick, 400);
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`timeout waiting for ${url}`));
          return;
        }
        setTimeout(tick, 400);
      });
    };
    tick();
  });
}

async function main(): Promise<void> {
  if (!fs.existsSync(recording)) {
    die(
      `Missing ${path.relative(root, recording)}. Run \`pnpm record:scan\` once with credentials, or restore the fixture from the repo.`,
    );
  }

  const serverDist = path.join(root, "packages/server/dist/index.js");
  if (!fs.existsSync(serverDist)) {
    console.log("[demo] Building packages (first run)…");
    const build = spawn("pnpm", ["build"], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    const code = await new Promise<number | null>((resolve) => {
      build.on("exit", (c) => resolve(c));
    });
    if (code !== 0) die(`pnpm build failed with code ${code}`);
  }

  process.env.KEYRING_DEMO = "1";
  process.env.KEYRING_PGLITE = "1";
  process.env.KEYRING_PGLITE_PATH = pglitePath;
  process.env.KEYRING_SCAN_DRIVER = "replay";
  process.env.KEYRING_EXECUTE_DRY_RUN = "1";
  process.env.PORT = process.env.PORT ?? "3001";
  // Clear DATABASE_URL so demo never requires Docker Postgres
  delete process.env.DATABASE_URL;

  console.log("[demo] Migrating embedded PGlite…");
  await runMigrations();

  console.log("[demo] Starting API (replay, dry-run, no API keys)…");
  const server = spawn(
    "pnpm",
    ["--filter", "@keyring/server", "exec", "tsx", "src/index.ts"],
    {
      cwd: root,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.push(server);
  server.stdout?.on("data", (b) => process.stdout.write(b));
  server.stderr?.on("data", (b) => process.stderr.write(b));
  server.on("exit", (code) => {
    if (code && code !== 0) die(`API exited with code ${code}`);
  });

  await waitHealth(`http://127.0.0.1:${process.env.PORT}/health`).catch((e) =>
    die(String(e)),
  );

  console.log("[demo] Starting UI…");
  const web = spawn(
    "pnpm",
    ["--filter", "@keyring/web", "exec", "vite", "--host", "127.0.0.1", "--port", "5173"],
    {
      cwd: root,
      env: {
        ...process.env,
        VITE_SCAN_DRIVER: "replay",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.push(web);
  web.stdout?.on("data", (b) => process.stdout.write(b));
  web.stderr?.on("data", (b) => process.stderr.write(b));
  web.on("exit", (code) => {
    if (code && code !== 0) die(`UI exited with code ${code}`);
  });

  await waitHealth("http://127.0.0.1:5173/").catch((e) => die(String(e)));

  console.log(`
┌────────────────────────────────────────────────────────────┐
│  Keyring demo ready (offline replay — no credentials)      │
│                                                            │
│  UI:  http://127.0.0.1:5173                                │
│  API: http://127.0.0.1:${process.env.PORT}                                │
│                                                            │
│  Start a scan for "Ada Lovelace" — uses fixtures/recordings│
│  Execution stays dry-run by default. Ctrl+C to stop.       │
└────────────────────────────────────────────────────────────┘
`);

  const shutdown = () => {
    for (const c of children) c.kill("SIGTERM");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise(() => {
    /* keep alive until signal */
  });
}

main().catch((err) => {
  console.error(err);
  for (const c of children) c.kill("SIGTERM");
  process.exit(1);
});
