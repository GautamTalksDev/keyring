import { createHash } from "node:crypto";

import { asHashHex, type HashHex } from "./brand.js";

/**
 * Deterministic SHA-256 hex digest of a UTF-8 string. Pure (no I/O).
 */
export function sha256Hex(input: string): HashHex {
  return asHashHex(createHash("sha256").update(input, "utf8").digest("hex"));
}

/**
 * Stable JSON for hashing: sorted object keys, no whitespace variance.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortKeys(record[key]);
  }
  return sorted;
}
