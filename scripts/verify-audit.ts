#!/usr/bin/env tsx
/**
 * Independently verify a Keyring audit export hash chain.
 *
 *   curl -s "http://localhost:3001/audit/export?format=json" -o audit-export.json
 *   pnpm verify:audit audit-export.json
 *
 * Exit 0 if the chain is intact; exit 1 with a reason otherwise.
 * Does not need DATABASE_URL — third parties can verify from the file alone.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  parseAuditExport,
  verifyAuditChain,
} from "../packages/core/src/audit.js";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: pnpm verify:audit <audit-export.json>");
    process.exit(2);
  }

  const abs = path.resolve(file);
  const raw = JSON.parse(await readFile(abs, "utf8")) as unknown;
  const { records, verification: exportVerification } = parseAuditExport(raw);
  const result = verifyAuditChain(records);

  if (result.ok) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          file: abs,
          count: records.length,
          tip: "Hash chain intact — ledger is independently verifiable.",
          exportClaimedOk: exportVerification?.ok ?? null,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  console.error(
    JSON.stringify(
      {
        ok: false,
        file: abs,
        count: records.length,
        index: result.index,
        reason: result.reason,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
