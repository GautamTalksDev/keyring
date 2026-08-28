#!/usr/bin/env tsx
/**
 * One-shot fixture offboard for Checkpoint 11 demo:
 * approve Ada Lovelace revoke cards → dry-run → live execute → export audit.
 *
 *   pnpm exec tsx scripts/demo-offboard-audit.ts
 *   pnpm verify:audit fixtures/audit-export-demo.json
 */

import { writeFileSync } from "node:fs";
import path from "node:path";

import { createDb } from "../packages/server/src/db/client.js";
import { runMigrations } from "../packages/server/src/db/migrate.js";
import { createStandaloneApp } from "../packages/server/src/standalone.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://keyring:keyring@localhost:5432/keyring";

async function waitForScan(
  app: ReturnType<typeof createStandaloneApp>,
  scanId: string,
) {
  for (let i = 0; i < 120; i++) {
    const res = await app.inject({ method: "GET", url: `/scans/${scanId}` });
    const body = res.json() as { status: string };
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

  // Clean ledger so deterministic card ids are independently retryable in this demo
  await client`ALTER TABLE audit_records DISABLE TRIGGER audit_records_append_only`;
  await client`TRUNCATE TABLE audit_records`;
  await client`ALTER TABLE audit_records ENABLE TRIGGER audit_records_append_only`;

  const app = createStandaloneApp({ db });

  try {
    const create = await app.inject({
      method: "POST",
      url: "/scans",
      payload: {
        person: "Ada Lovelace",
        driver: "fixture",
        delayMsPerGrant: 0,
      },
    });
    if (create.statusCode >= 300) {
      console.error(create.json());
      process.exit(1);
    }
    const { scanId } = create.json() as { scanId: string };
    await waitForScan(app, scanId);

    const cardsRes = await app.inject({
      method: "GET",
      url: `/scans/${scanId}/cards`,
    });
    const cards = (
      cardsRes.json() as {
        cards: Array<{
          id: string;
          status: string;
          irreversible: boolean;
          proposedAction: { kind: string };
          grant: { system: string; resource: { displayName: string } };
        }>;
      }
    ).cards.filter(
      (c) => c.proposedAction.kind === "revoke" && c.status === "pending",
    );

    console.log(`Approving ${Math.min(8, cards.length)} revoke cards…`);
    for (const c of cards.slice(0, 8)) {
      await app.inject({
        method: "POST",
        url: `/cards/${c.id}/decision`,
        payload: {
          decision: "approve",
          by: "auditor@keyring.test",
          note: "cp11 offboard — intent only",
        },
      });
      console.log(
        `  approved ${c.grant.system} / ${c.grant.resource.displayName}${
          c.irreversible ? " [permanent]" : " [restorable]"
        }`,
      );
    }

    const dry = await app.inject({
      method: "POST",
      url: `/scans/${scanId}/execute`,
      payload: { approvedBy: "auditor@keyring.test" },
    });
    console.log("dry-run:", JSON.stringify(dry.json(), null, 2));

    const live = await app.inject({
      method: "POST",
      url: `/scans/${scanId}/execute`,
      payload: { approvedBy: "auditor@keyring.test", dryRun: false },
    });
    console.log("live:", JSON.stringify(live.json(), null, 2));

    const audit = await app.inject({ method: "GET", url: "/audit" });
    console.log(
      "verification:",
      (audit.json() as { verification: unknown }).verification,
    );

    const exp = await app.inject({
      method: "GET",
      url: "/audit/export?format=json",
    });
    const out = path.resolve("fixtures/audit-export-demo.json");
    writeFileSync(out, `${JSON.stringify(exp.json(), null, 2)}\n`);
    console.log("wrote", out);
  } finally {
    await app.close();
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
