import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import {
  normalizePolicy,
  type KeyringPolicy,
  EMPTY_POLICY,
} from "@keyring/core";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

let cached: { path: string; mtimeMs: number; policy: KeyringPolicy } | null =
  null;

export function policyPath(): string {
  return (
    process.env.KEYRING_POLICY_PATH ?? path.join(repoRoot, "keyring.yml")
  );
}

/**
 * Load and cache keyring.yml. Missing file → EMPTY_POLICY (safe defaults).
 */
export async function loadPolicy(): Promise<KeyringPolicy> {
  const file = policyPath();
  try {
    const stat = await import("node:fs/promises").then((fs) => fs.stat(file));
    if (
      cached &&
      cached.path === file &&
      cached.mtimeMs === stat.mtimeMs
    ) {
      return cached.policy;
    }
    const raw = await readFile(file, "utf8");
    const parsed = parseYaml(raw);
    const policy = normalizePolicy(parsed);
    cached = { path: file, mtimeMs: stat.mtimeMs, policy };
    return policy;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      cached = { path: file, mtimeMs: 0, policy: EMPTY_POLICY };
      return EMPTY_POLICY;
    }
    throw err;
  }
}

/** Test helper — bypass disk. */
export function setPolicyCacheForTests(policy: KeyringPolicy | null): void {
  if (!policy) {
    cached = null;
    return;
  }
  cached = { path: ":memory:", mtimeMs: Date.now(), policy };
}

export { repoRoot as policyRepoRoot };
