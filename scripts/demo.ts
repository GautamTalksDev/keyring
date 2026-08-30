/**
 * Judge-facing one-command demo: embedded PGlite, seeded recording replay,
 * no API credentials. Starts API + UI.
 *
 * Usage: pnpm demo
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
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

async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    const available = await new Promise<boolean>((resolve, reject) => {
      const probe = net.createServer();
      probe.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          resolve(false);
          return;
        }
        reject(err);
      });
      probe.listen(port, "0.0.0.0", () => {
        probe.close((err) => {
          if (err) reject(err);
          else resolve(true);
        });
      });
    });
    if (available) return port;
  }
  throw new Error(`no available port in range ${startPort}-${startPort + 19}`);
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
  // Clear DATABASE_URL so demo never requires Docker Postgres
  delete process.env.DATABASE_URL;

  const requestedApiPort = Number(process.env.PORT ?? 3001);
  const apiPort = await findAvailablePort(requestedApiPort);
  const requestedUiPort = Number(process.env.VITE_PORT ?? 5173);
  const uiPort = await findAvailablePort(requestedUiPort);
  if (apiPort !== requestedApiPort) {
    console.log(`[demo] API port ${requestedApiPort} is busy; using ${apiPort}.`);
  }
  if (uiPort !== requestedUiPort) {
    console.log(`[demo] UI port ${requestedUiPort} is busy; using ${uiPort}.`);
  }
  process.env.PORT = String(apiPort);

  console.log("[demo] Migrating embedded PGlite…");
  await runMigrations();

  console.log("[demo] Starting API (replay, dry-run, no API keys)…");
  const server = spawn("pnpm", ["--filter", "@keyring/server", "exec", "tsx", "src/index.ts"], {
    cwd: root,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(server);
  server.stdout?.on("data", (b) => process.stdout.write(b));
  server.stderr?.on("data", (b) => {
    const text = String(b);
    if (/EADDRINUSE|address already in use/i.test(text)) {
      die(
        `API port ${apiPort} is already in use. Stop the process using it or set PORT to another free port.`,
      );
    }
    process.stderr.write(text);
  });
  server.on("exit", (code) => {
    if (code && code !== 0) die(`API exited with code ${code}`);
  });

  await waitHealth(`http://127.0.0.1:${process.env.PORT}/health`).catch((e) => die(String(e)));

  console.log("[demo] Starting UI…");
  const web = spawn(
    "pnpm",
    ["--filter", "@keyring/web", "exec", "vite", "--host", "127.0.0.1", "--port", String(uiPort)],
    {
      cwd: root,
      env: {
        ...process.env,
        VITE_SCAN_DRIVER: "replay",
        VITE_API_BASE_URL: "",
        VITE_API_PORT: String(apiPort),
        KEYRING_REPLAY_SPEED: process.env.KEYRING_REPLAY_SPEED ?? "20",
        KEYRING_REPLAY_MAX_GAP_MS: process.env.KEYRING_REPLAY_MAX_GAP_MS ?? "5000",
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

  await waitHealth(`http://127.0.0.1:${uiPort}/`).catch((e) => die(String(e)));

  console.log(`
┌────────────────────────────────────────────────────────────┐
│  Keyring demo ready (offline replay — no credentials)      │
│                                                            │
│  UI:  http://127.0.0.1:${uiPort}                                │
│  API: http://127.0.0.1:${apiPort}                                │
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
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[demo] ${message}`);
  for (const c of children) c.kill("SIGTERM");
  process.exit(1);
});
