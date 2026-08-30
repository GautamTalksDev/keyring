import { Cron } from "croner";
import { redactErrorMessage } from "@keyring/core";
import type { FastifyBaseLogger } from "fastify";

import type { Database } from "../db/client.js";
import { loadPolicy } from "../policy/load.js";
import { startScan } from "../services/scan-runner.js";

let job: Cron | null = null;

/**
 * Start optional scheduled re-audits from keyring.yml `reaudit.cron`
 * or KEYRING_REAUDIT_CRON.
 */
export async function startReauditScheduler(
  db: Database["db"],
  log: FastifyBaseLogger,
): Promise<void> {
  const policy = await loadPolicy();
  const expr = process.env.KEYRING_REAUDIT_CRON?.trim() || policy.reaudit?.cron?.trim() || "";
  if (!expr) {
    log.info("Re-audit cron: disabled (set reaudit.cron or KEYRING_REAUDIT_CRON)");
    return;
  }

  job?.stop();
  job = new Cron(expr, { timezone: "UTC" }, async () => {
    try {
      log.info({ cron: expr }, "scheduled re-audit starting");
      const result = await startScan(
        db,
        {
          reaudit: true,
          diffOnly: policy.reaudit?.diff_only ?? true,
          person: process.env.KEYRING_REAUDIT_PERSON ?? "scheduled-reaudit",
          driver: "fixture",
          delayMsPerGrant: 0,
        },
        log,
      );
      log.info({ scanId: result.scanId }, "scheduled re-audit enqueued");
    } catch (err) {
      log.error(
        { error: redactErrorMessage(err instanceof Error ? err.message : String(err)) },
        "scheduled re-audit failed",
      );
    }
  });
  log.info({ cron: expr, next: job.nextRun()?.toISOString() }, "Re-audit cron armed");
}

export function stopReauditScheduler(): void {
  job?.stop();
  job = null;
}
