import { CI_TRAP_MARKER, type ApprovalCard } from "@keyring/core";
import type { FastifyBaseLogger } from "fastify";

import type { Database } from "../db/client.js";
import { classifyProductError } from "../errors/classify.js";
import {
  appendChainedAudit,
  hasSuccessfulExecute,
  listApprovedCardsForScan,
} from "../db/store.js";
import { scanBus, scanLog, type ScanProgressEvent } from "../api/progress.js";
import {
  evidenceWithUndo,
  resolveExecuteDryRun,
  revokeGrant,
} from "./revoke-runtime.js";

export interface ExecuteOptions {
  db: Database["db"];
  scanId: string;
  approvedBy: string;
  log: FastifyBaseLogger;
  /**
   * Walk the full execute path without mutating APIs.
   * Defaults to KEYRING_EXECUTE_DRY_RUN (ON unless explicitly disabled).
   */
  dryRun?: boolean;
  /** Optional SSE emit hook (defaults to scanBus). */
  onEvent?: (event: ScanProgressEvent) => void;
}

export interface ExecuteSummary {
  dryRun: boolean;
  executed: number;
  failed: number;
  skipped: number;
  results: Array<{
    cardId: string;
    status: "success" | "failed" | "skipped" | "dry_run";
    error?: string;
    detail?: string;
    errorKind?: string;
    recovery?: string;
    restorable?: boolean;
    undoHint?: {
      permission: string;
      restoreMethod: string;
      params: Record<string, unknown>;
    };
  }>;
}

/**
 * Execute all approved cards for a scan.
 * Intent (approve) is separate — this is the explicit execute step.
 * Writes an AuditRecord BEFORE and AFTER each mutating attempt.
 *
 * Each card is independently retryable: prior successful executes are skipped.
 * Partial batch failure never invents success — failed cards stay failed in the ledger.
 */
export async function executeApprovedCards(
  opts: ExecuteOptions,
): Promise<ExecuteSummary> {
  const dryRun = resolveExecuteDryRun(opts.dryRun);
  const log = scanLog(opts.log, opts.scanId);
  const emit =
    opts.onEvent ??
    ((e: ScanProgressEvent) => {
      scanBus.publish(e);
    });

  const cards = await listApprovedCardsForScan(opts.db, opts.scanId);
  const results: ExecuteSummary["results"] = [];
  let executed = 0;
  let failed = 0;
  let skipped = 0;

  for (const card of cards) {
    if (!isExecutable(card)) {
      skipped += 1;
      results.push({ cardId: card.id, status: "skipped", error: skipReason(card) });
      continue;
    }

    if (await hasSuccessfulExecute(opts.db, card.id)) {
      skipped += 1;
      results.push({
        cardId: card.id,
        status: "skipped",
        error: "already_executed",
      });
      continue;
    }

    const action =
      card.proposedAction.kind === "downgrade"
        ? ("execute_downgrade" as const)
        : card.proposedAction.kind === "transfer_ownership"
          ? ("execute_transfer" as const)
          : ("execute_revoke" as const);

    const approvedAt = card.decision?.at ?? new Date();
    const beforeAt = new Date();
    const beforeError = dryRun ? "dry_run_attempt_started" : "attempt_started";

    // BEFORE attempt — crash mid-revoke is still visible
    await appendChainedAudit(opts.db, {
      cardId: card.id,
      action,
      approvedBy: opts.approvedBy,
      approvedAt,
      executedAt: beforeAt,
      result: "partial",
      error: beforeError,
      evidenceSnapshot: card.grant.evidence,
    });
    emit({
      type: "execute.card",
      scanId: opts.scanId,
      cardId: card.id,
      phase: "before",
      result: "partial",
      dryRun,
      at: beforeAt.toISOString(),
    });
    log.info(
      { cardId: card.id, phase: "before", dryRun },
      "execute attempt started",
    );

    let afterResult: "success" | "failed" | "partial" = "failed";
    let error: string | undefined;
    let detail: string | undefined;
    let undoHint: ExecuteSummary["results"][number]["undoHint"];
    let restorable: boolean | undefined;

    try {
      if (card.proposedAction.kind === "revoke") {
        const revoke = await revokeGrant({
          grant: card.grant,
          approvedBy: opts.approvedBy,
          approvalCardId: card.id,
          dryRun,
        });
        if (revoke.ok) {
          detail = revoke.detail;
          if (revoke.undoHint) {
            undoHint = {
              permission: revoke.undoHint.permission,
              restoreMethod: revoke.undoHint.restoreMethod,
              params: revoke.undoHint.params,
            };
            restorable = true;
          } else {
            restorable = false;
          }
          if (dryRun) {
            afterResult = "partial";
            error = "dry_run";
          } else {
            afterResult = "success";
            if (revoke.alreadyAbsent) {
              detail = revoke.detail ?? "already_absent";
            }
          }
        } else {
          afterResult = "failed";
          error = revoke.error;
        }
      } else if (dryRun) {
        afterResult = "partial";
        error = "dry_run";
        detail = `dry_run: would ${card.proposedAction.kind}`;
        restorable = !card.irreversible;
      } else {
        // Non-revoke approved actions (fixture / unsupported live) recorded as success no-ops
        afterResult = "success";
        detail = `${card.proposedAction.kind} recorded (no connector mutate)`;
        restorable = !card.irreversible;
      }
    } catch (err) {
      afterResult = "failed";
      error = err instanceof Error ? err.message : String(err);
    }

    const afterAt = new Date();
    const evidence = evidenceWithUndo(
      card.grant.evidence,
      undoHint
        ? {
            restorable: true,
            system: card.grant.system,
            permission: undoHint.permission,
            restoreMethod: undoHint.restoreMethod,
            params: undoHint.params,
          }
        : undefined,
      detail,
    );

    await appendChainedAudit(opts.db, {
      cardId: card.id,
      action,
      approvedBy: opts.approvedBy,
      approvedAt,
      executedAt: afterAt,
      result: afterResult,
      ...(error ? { error } : {}),
      evidenceSnapshot: evidence,
    });
    emit({
      type: "execute.card",
      scanId: opts.scanId,
      cardId: card.id,
      phase: "after",
      result: afterResult,
      dryRun,
      ...(error ? { error } : {}),
      ...(detail ? { detail } : {}),
      ...(restorable !== undefined ? { restorable } : {}),
      at: afterAt.toISOString(),
    });
    log.info(
      {
        cardId: card.id,
        phase: "after",
        result: afterResult,
        error,
        dryRun,
      },
      "execute attempt finished",
    );

    if (dryRun && afterResult !== "failed") {
      executed += 1;
      results.push({
        cardId: card.id,
        status: "dry_run",
        ...(error ? { error } : {}),
        ...(detail ? { detail } : {}),
        ...(restorable !== undefined ? { restorable } : {}),
        ...(undoHint ? { undoHint } : {}),
      });
    } else if (afterResult === "success") {
      executed += 1;
      results.push({
        cardId: card.id,
        status: "success",
        ...(detail ? { detail } : {}),
        ...(restorable !== undefined ? { restorable } : {}),
        ...(undoHint ? { undoHint } : {}),
      });
    } else {
      failed += 1;
      const classified = classifyProductError(
        new Error(error ?? "execution failed"),
        "execution",
      );
      results.push({
        cardId: card.id,
        status: "failed",
        error,
        errorKind: classified.kind,
        recovery: classified.recovery,
        ...(detail ? { detail } : {}),
      });
    }
  }

  const doneAt = new Date().toISOString();
  emit({
    type: "execute.done",
    scanId: opts.scanId,
    at: doneAt,
    dryRun,
    executed,
    failed,
    skipped,
  });
  log.info({ executed, failed, skipped, dryRun }, "execute scan finished");

  return { dryRun, executed, failed, skipped, results };
}

function isExecutable(card: ApprovalCard): boolean {
  if (card.status !== "approved") return false;
  if (card.proposedAction.kind === "flag_only") return false;
  if (card.grant.evidence.some((e) => e.claim.includes(CI_TRAP_MARKER))) {
    return false;
  }
  return true;
}

function skipReason(card: ApprovalCard): string {
  if (card.proposedAction.kind === "flag_only") return "flag_only";
  if (card.grant.evidence.some((e) => e.claim.includes(CI_TRAP_MARKER))) {
    return "ci_trap";
  }
  return "not_executable";
}
