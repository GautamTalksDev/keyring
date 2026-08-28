#!/usr/bin/env node
/**
 * Execute identity reconciliation over JSON.
 *
 * Usage (sandbox / local):
 *   node dist/identity/cli.js < input.json > result.json
 *   node dist/identity/cli.js path/to/input.json
 *
 * Designed for TrueForge sandbox: no network, stdin/file in → stdout out.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { runReconciliationFromJson, type ReconciliationJsonInput } from "./run.js";

function resolveInputPath(pathArg: string): string {
  if (path.isAbsolute(pathArg)) return pathArg;
  const fromCwd = path.resolve(process.cwd(), pathArg);
  if (existsSync(fromCwd)) return fromCwd;
  // `pnpm --filter @keyring/core exec` uses the package directory as cwd.
  const fromMonorepoRoot = path.resolve(process.cwd(), "../..", pathArg);
  if (existsSync(fromMonorepoRoot)) return fromMonorepoRoot;
  return fromCwd;
}

function readInput(): string {
  const pathArg = process.argv.slice(2).find((a) => a !== "--");
  if (pathArg && pathArg !== "-") {
    return readFileSync(resolveInputPath(pathArg), "utf8");
  }
  return readFileSync(0, "utf8");
}

function main(): void {
  const raw = readInput();
  const doc = JSON.parse(raw) as ReconciliationJsonInput;
  if (!doc || !Array.isArray(doc.grants)) {
    throw new Error("Input JSON must contain a grants array");
  }
  const result = runReconciliationFromJson(doc);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
