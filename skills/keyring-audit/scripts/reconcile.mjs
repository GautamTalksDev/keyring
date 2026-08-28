#!/usr/bin/env node
/**
 * Sandbox-friendly reconcile entry for the keyring-audit skill.
 * Delegates to @keyring/core when available; otherwise expects KEYRING_RECONCILE_URL.
 *
 * Usage: node reconcile.mjs <input.json>
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node reconcile.mjs <input.json>");
  process.exit(2);
}

const raw = readFileSync(path.resolve(inputPath), "utf8");
const doc = JSON.parse(raw);

async function main() {
  // Prefer workspace / installed core (local + sandbox with package mounted).
  try {
    const corePaths = [
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/core/dist/identity/run.js"),
      "@keyring/core",
    ];
    for (const p of corePaths) {
      try {
        if (p.startsWith("@")) {
          const mod = await import(p);
          if (typeof mod.runReconciliationFromJson === "function") {
            const result = mod.runReconciliationFromJson(doc);
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            return;
          }
        } else {
          const mod = await import(p);
          const result = mod.runReconciliationFromJson(doc);
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          return;
        }
      } catch {
        /* try next */
      }
    }
  } catch {
    /* fall through */
  }

  // Last resort: same CLI via require of built package relative to repo.
  try {
    const runPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../packages/core/dist/identity/run.js",
    );
    const { runReconciliationFromJson } = require(runPath);
    const result = runReconciliationFromJson(doc);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  } catch (err) {
    console.error(
      "Could not load identity module. Build @keyring/core or set sandbox to include packages/core/dist.",
      err,
    );
    process.exit(1);
  }
}

await main();
