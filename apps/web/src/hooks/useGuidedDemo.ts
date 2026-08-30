import { useCallback, useEffect, useRef, useState } from "react";

import { executeScanStream, fetchAudit, postDecision } from "../api/client.js";
import type { ApiCard, AuditRecord, AuditVerification, ExecuteResult } from "../api/types.js";
import type { AgentActivityState } from "../api/types.js";
import { queueSections } from "../lib/format.js";

export type GuidedDemoPhase =
  | "idle"
  | "scanning"
  | "reconciling"
  | "headline"
  | "approving"
  | "waiting"
  | "holding"
  | "executing"
  | "verifying"
  | "ledger"
  | "stopped"
  | "error";

export interface GuidedDemoState {
  phase: GuidedDemoPhase;
  step: number;
  totalSteps: number;
  scanId: string | null;
  targetCardId: string | null;
  message: string | null;
  error: string | null;
  results: ExecuteResult[];
  auditRecords: AuditRecord[];
  verification: AuditVerification | null;
}

const DEFAULT_MIN_RUNTIME_MS = 90_000;
const HEADLINE_HOLD_MS = 3_000;
const DECISION_GAP_MS = 1_500;
const HOLD_CONFIRMATION_MS = 1_000;
const EXECUTION_RESULT_HOLD_MS = 15_000;
const POLL_MS = 100;

function configuredMinRuntime(): number {
  const value = Number(import.meta.env.VITE_GUIDED_DEMO_MIN_RUNTIME_MS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_MIN_RUNTIME_MS;
}

export function isTerminalScanStatus(status: AgentActivityState["status"]): boolean {
  return status !== "idle" && status !== "running";
}

export function isCurrentGuidedRun(runId: number, currentRunId: number, aborted: boolean): boolean {
  return runId === currentRunId && !aborted;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error("Guided demo stopped"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Guided demo stopped"));
      },
      { once: true },
    );
  });
}

function waitFor(predicate: () => boolean, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = () => {
      if (signal.aborted) {
        reject(signal.reason ?? new Error("Guided demo stopped"));
        return;
      }
      if (predicate()) {
        resolve();
        return;
      }
      setTimeout(check, POLL_MS);
    };
    check();
  });
}

function isCiProtectedCard(card: ApiCard): boolean {
  return (
    card.protected === true &&
    (card.proposedAction.kind === "flag_only" ||
      card.grant.evidence.some((e) => /CI|do.not.revoke/i.test(e.claim)))
  );
}

function initialState(): GuidedDemoState {
  return {
    phase: "idle",
    step: 0,
    totalSteps: 7,
    scanId: null,
    targetCardId: null,
    message: null,
    error: null,
    results: [],
    auditRecords: [],
    verification: null,
  };
}

export function useGuidedDemo({
  activity,
  cards,
  beginScan,
  updateCard,
  cancelScan,
  resetDemoScan,
}: {
  activity: AgentActivityState;
  cards: ApiCard[];
  beginScan: (person: string) => Promise<string | null>;
  updateCard: (card: ApiCard) => void;
  cancelScan: () => void;
  resetDemoScan: (scanId: string) => Promise<unknown>;
}) {
  const [state, setState] = useState<GuidedDemoState>(initialState);
  const activityRef = useRef(activity);
  const cardsRef = useRef(cards);
  const runIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const gateResolverRef = useRef<(() => void) | null>(null);
  const pendingDecisionsRef = useRef(new Set<Promise<unknown>>());
  const committedDecisionIdsRef = useRef(new Set<string>());
  const resetPromiseRef = useRef<Promise<void> | null>(null);

  activityRef.current = activity;
  cardsRef.current = cards;

  const stop = useCallback(() => {
    const scanId = activityRef.current.scanId;
    runIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    gateResolverRef.current?.();
    gateResolverRef.current = null;
    cancelScan();
    if (
      scanId &&
      (pendingDecisionsRef.current.size > 0 || committedDecisionIdsRef.current.size > 0)
    ) {
      const resetPromise = Promise.allSettled([...pendingDecisionsRef.current])
        .then(() => resetDemoScan(scanId))
        .then(() => undefined);
      resetPromiseRef.current = resetPromise;
      void resetPromise
        .catch(() => undefined)
        .finally(() => {
          if (resetPromiseRef.current === resetPromise) {
            resetPromiseRef.current = null;
          }
        });
      committedDecisionIdsRef.current.clear();
    }
    setState((previous) => ({
      ...previous,
      phase: "stopped",
      message: "Guided demo stopped. Start it again for another take.",
    }));
  }, [cancelScan, resetDemoScan]);

  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      controllerRef.current?.abort();
      gateResolverRef.current?.();
    };
  }, []);

  const continueGate = useCallback(() => {
    if (state.phase !== "waiting") return;
    gateResolverRef.current?.();
    gateResolverRef.current = null;
  }, [state.phase]);

  const run = useCallback(async () => {
    if (
      state.phase !== "idle" &&
      state.phase !== "stopped" &&
      state.phase !== "error" &&
      state.phase !== "ledger"
    ) {
      return;
    }

    await resetPromiseRef.current?.catch(() => undefined);
    committedDecisionIdsRef.current.clear();
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    const controller = new AbortController();
    controllerRef.current = controller;
    const startedAt = Date.now();
    let pausedAt: number | null = null;
    let pausedMs = 0;

    const current = () => isCurrentGuidedRun(runId, runIdRef.current, controller.signal.aborted);
    const update = (patch: Partial<GuidedDemoState>) => {
      if (current()) setState((previous) => ({ ...previous, ...patch }));
    };

    setState({
      ...initialState(),
      phase: "scanning",
      step: 1,
      message: "Starting the guided scan…",
    });

    try {
      const scanId = await beginScan("Ada Lovelace");
      if (!current()) return;
      if (!scanId) {
        throw new Error(activityRef.current.error ?? "The guided scan could not start.");
      }
      update({
        scanId,
        step: 2,
        message: "Subagents are scanning across connected systems…",
      });

      let reconciliationAnnounced = false;
      await waitFor(() => {
        if (
          !reconciliationAnnounced &&
          activityRef.current.sandbox.active &&
          activityRef.current.scanId === scanId &&
          activityRef.current.status === "running"
        ) {
          reconciliationAnnounced = true;
          update({
            phase: "reconciling",
            step: 3,
            message: "Reconciling identities in the sandbox…",
          });
        }
        return (
          activityRef.current.scanId === scanId && isTerminalScanStatus(activityRef.current.status)
        );
      }, controller.signal);
      if (activityRef.current.status !== "completed") {
        throw new Error(activityRef.current.error ?? "The guided scan did not complete.");
      }
      await waitFor(() => cardsRef.current.length > 0, controller.signal);

      update({
        phase: "headline",
        step: 4,
        message: "Scan complete. Hold on the summary so it can be read.",
      });
      await wait(HEADLINE_HOLD_MS, controller.signal);

      const ordered = queueSections(cardsRef.current).visualOrder;
      const safeCards = ordered.filter(
        (card) =>
          card.status === "pending" &&
          card.protected !== true &&
          card.proposedAction.kind !== "flag_only",
      );
      const ciCard =
        ordered.find(isCiProtectedCard) ?? ordered.find((card) => card.protected === true);
      if (!ciCard) {
        throw new Error("The guided demo requires a protected CI card.");
      }

      const decide = async (
        cardId: string,
        body: {
          decision: "approve" | "hold" | "reject";
          note?: string;
          by?: string;
        },
      ) => {
        const request = postDecision(cardId, body, controller.signal);
        pendingDecisionsRef.current.add(request);
        try {
          const result = await request;
          if (!current()) return null;
          committedDecisionIdsRef.current.add(cardId);
          updateCard(result.card);
          return result;
        } finally {
          pendingDecisionsRef.current.delete(request);
        }
      };

      for (let index = 0; index < safeCards.length; index += 1) {
        const card = safeCards[index]!;
        update({
          phase: "approving",
          step: 5,
          targetCardId: card.id,
          message: `Approving safe card ${index + 1} of ${safeCards.length}…`,
        });
        const result = await decide(card.id, {
          decision: "approve",
          by: "guided-demo",
        });
        if (!result) return;
        if (index < safeCards.length - 1) {
          await wait(DECISION_GAP_MS, controller.signal);
        }
      }

      update({
        phase: "waiting",
        step: 6,
        targetCardId: ciCard.id,
        message: "Human approval gate — the protected CI card is waiting.",
      });
      pausedAt = Date.now();
      await new Promise<void>((resolve, reject) => {
        if (controller.signal.aborted) {
          reject(controller.signal.reason ?? new Error("Guided demo stopped"));
          return;
        }
        gateResolverRef.current = resolve;
        controller.signal.addEventListener(
          "abort",
          () => reject(controller.signal.reason ?? new Error("Guided demo stopped")),
          { once: true },
        );
      });
      if (pausedAt !== null) {
        pausedMs += Date.now() - pausedAt;
        pausedAt = null;
      }

      update({
        phase: "holding",
        step: 6,
        message: "Recording the human decision: belongs to CI, flag the owner.",
      });
      const held = await decide(ciCard.id, {
        decision: "hold",
        note: "belongs to CI, flag the owner",
        by: "guided-demo",
      });
      if (!held) return;
      await wait(HOLD_CONFIRMATION_MS, controller.signal);

      update({
        phase: "executing",
        step: 7,
        targetCardId: null,
        message: "Executing approved cards and recording each result…",
      });
      const streamResults: ExecuteResult[] = [];
      const execution = await executeScanStream(
        scanId,
        "guided-demo",
        true,
        controller.signal,
        async (event) => {
          if (event.type !== "execute.card" || event.phase !== "after") return;
          const status =
            event.result === "success"
              ? "success"
              : event.result === "failed"
                ? "failed"
                : "dry_run";
          const result: ExecuteResult = {
            cardId: String(event.cardId),
            status,
            ...(event.error ? { error: String(event.error) } : {}),
            ...(event.detail ? { detail: String(event.detail) } : {}),
          };
          streamResults.push(result);
          update({
            step: 7,
            targetCardId: result.cardId,
            results: [...streamResults],
          });
          await wait(EXECUTION_RESULT_HOLD_MS, controller.signal);
        },
      );
      update({ results: execution.results });

      const remaining = Math.max(0, configuredMinRuntime() - (Date.now() - startedAt - pausedMs));
      if (remaining > 0) {
        update({
          phase: "verifying",
          step: 7,
          message: "Holding the verification view for the recording…",
        });
        await wait(remaining, controller.signal);
      }

      update({ phase: "verifying", step: 7, message: "Verifying the append-only audit chain…" });
      const audit = await fetchAudit();
      update({
        phase: "ledger",
        step: 7,
        message: "Audit ledger · hash verification complete",
        auditRecords: audit.records,
        verification: audit.verification,
      });
    } catch (err) {
      if (controller.signal.aborted || runIdRef.current !== runId) return;
      setState((previous) => ({
        ...previous,
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
        message: "Guided demo stopped with an error.",
      }));
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [beginScan, state.phase, updateCard]);

  const active =
    state.phase !== "idle" &&
    state.phase !== "stopped" &&
    state.phase !== "error" &&
    state.phase !== "ledger";

  return {
    state,
    active,
    run,
    stop,
    continueGate,
  };
}
