import { useEffect, useReducer, useRef } from "react";

import { fetchCards, startScan, subscribeScanStream } from "../api/client.js";
import type {
  AgentActivityState,
  ApiCard,
  ScanProgressEvent,
  SubagentState,
} from "../api/types.js";
import { classifyClientError, recoveryFor } from "../lib/errors.js";

export type ScanSessionState = {
  activity: AgentActivityState;
  cards: ApiCard[];
  loading: boolean;
  error: string | null;
};

type Action =
  | { type: "reset" }
  | { type: "dismiss_error" }
  | { type: "scan_starting"; person: string }
  | {
      type: "scan_started";
      scanId: string;
      person: string;
      driver?: string | null;
      recordingId?: string | null;
    }
  | { type: "scan_error"; error: string }
  | { type: "event"; event: ScanProgressEvent }
  | {
      type: "cards";
      scanId: string;
      cards: ApiCard[];
      status: string;
      costs?: AgentActivityState["costs"];
      driver?: string | null;
      recordingId?: string | null;
    }
  | { type: "card_updated"; card: ApiCard };

export const emptyActivity = (): AgentActivityState => ({
  scanId: null,
  status: "idle",
  person: null,
  subagents: {},
  sandbox: { active: false, label: null, detail: null },
  log: [],
  error: null,
  errorKind: null,
  recovery: null,
  grantsDiscovered: null,
  costs: null,
  driver: null,
  recordingId: null,
});

function pushLog(
  state: AgentActivityState,
  text: string,
  kind: "info" | "sandbox" | "warn" = "info",
  at?: string,
): AgentActivityState {
  return {
    ...state,
    log: [...state.log.slice(-80), { at: at ?? new Date().toISOString(), text, kind }],
  };
}

export function reduce(state: ScanSessionState, action: Action): ScanSessionState {
  switch (action.type) {
    case "reset":
      return { activity: emptyActivity(), cards: [], loading: false, error: null };
    case "dismiss_error":
      return {
        ...state,
        error: null,
        activity: {
          ...state.activity,
          error: null,
          errorKind: null,
          recovery: null,
        },
      };
    case "scan_starting":
      return {
        ...state,
        loading: true,
        error: null,
        cards: [],
        activity: {
          ...emptyActivity(),
          status: "running",
          person: action.person,
          log: [
            {
              at: new Date().toISOString(),
              text: `Starting scan for ${action.person}`,
              kind: "info",
            },
          ],
        },
      };
    case "scan_started":
      return {
        ...state,
        loading: false,
        activity: {
          ...state.activity,
          scanId: action.scanId,
          person: action.person,
          status: "running",
          ...(action.driver ? { driver: action.driver } : {}),
          ...(action.recordingId ? { recordingId: action.recordingId } : {}),
        },
      };
    case "scan_error": {
      const kind = classifyClientError(action.error);
      return {
        ...state,
        loading: false,
        error: action.error,
        activity: {
          ...state.activity,
          status: "failed",
          error: action.error,
          errorKind: kind,
          recovery: recoveryFor(kind),
        },
      };
    }
    case "cards":
      if (state.activity.scanId !== action.scanId) return state;
      return {
        ...state,
        cards: action.cards,
        activity: {
          ...state.activity,
          status:
            action.status === "completed"
              ? "completed"
              : action.status === "failed"
                ? "failed"
                : action.status === "cost_capped"
                  ? "cost_capped"
                  : action.status === "partial"
                    ? "partial"
                    : state.activity.status,
          ...(action.costs ? { costs: action.costs } : {}),
          ...(action.driver ? { driver: action.driver } : {}),
          ...(action.recordingId ? { recordingId: action.recordingId } : {}),
        },
      };
    case "card_updated":
      return {
        ...state,
        cards: state.cards.map((c) => (c.id === action.card.id ? action.card : c)),
      };
    case "event":
      return { ...state, activity: applyEvent(state.activity, action.event) };
    default:
      return state;
  }
}

export function applyEvent(
  activity: AgentActivityState,
  event: ScanProgressEvent,
): AgentActivityState {
  const at = event.at ?? new Date().toISOString();
  switch (event.type) {
    case "scan.started":
      return pushLog(
        { ...activity, status: "running" },
        `Scan started${event.person ? ` — ${String(event.person)}` : ""}`,
        "info",
        at,
      );
    case "subagent.queued": {
      const systemId = String(event.systemId);
      const sub: SubagentState = {
        systemId,
        displayName: String(event.displayName ?? systemId),
        status: "queued",
        found: 0,
        startedAt: at,
      };
      return {
        ...activity,
        subagents: { ...activity.subagents, [systemId]: sub },
      };
    }
    case "subagent.started": {
      const systemId = String(event.systemId);
      const sub: SubagentState = {
        systemId,
        displayName: String(event.displayName ?? systemId),
        status: "scanning",
        found: 0,
        startedAt: at,
      };
      return pushLog(
        {
          ...activity,
          subagents: { ...activity.subagents, [systemId]: sub },
        },
        `Subagent on ${sub.displayName}`,
        "info",
        at,
      );
    }
    case "subagent.progress": {
      const systemId = String(event.systemId);
      const prev = activity.subagents[systemId];
      if (!prev) return activity;
      return {
        ...activity,
        subagents: {
          ...activity.subagents,
          [systemId]: {
            ...prev,
            status: "scanning",
            found: Number(event.found ?? 0),
          },
        },
      };
    }
    case "subagent.done": {
      const systemId = String(event.systemId);
      const prev = activity.subagents[systemId];
      const found = Number(event.found ?? prev?.found ?? 0);
      const next = prev
        ? { ...prev, status: "done" as const, found }
        : {
            systemId,
            displayName: systemId,
            status: "done" as const,
            found,
            startedAt: at,
          };
      return pushLog(
        {
          ...activity,
          subagents: { ...activity.subagents, [systemId]: next },
        },
        `${next.displayName}: ${found} grant${found === 1 ? "" : "s"}`,
        "info",
        at,
      );
    }
    case "subagent.failed": {
      const systemId = String(event.systemId);
      const prev = activity.subagents[systemId];
      const displayName = String(event.displayName ?? prev?.displayName ?? systemId);
      const next = prev
        ? { ...prev, status: "failed" as const }
        : {
            systemId,
            displayName,
            status: "failed" as const,
            found: 0,
            startedAt: at,
          };
      const msg = String(event.error ?? "connector failed");
      return pushLog(
        {
          ...activity,
          subagents: { ...activity.subagents, [systemId]: next },
          errorKind: String(event.errorKind ?? activity.errorKind ?? "unknown"),
          recovery: recoveryFor(
            String(event.errorKind ?? ""),
            event.recovery != null ? String(event.recovery) : null,
          ),
        },
        `${displayName} failed: ${msg}`,
        "warn",
        at,
      );
    }
    case "reconcile.started":
      return pushLog(
        {
          ...activity,
          subagents: Object.fromEntries(
            Object.entries(activity.subagents).map(([systemId, subagent]) => [
              systemId,
              {
                ...subagent,
                status: subagent.status === "failed" ? "failed" : "reconciling",
              },
            ]),
          ),
          sandbox: {
            active: true,
            label: "Sandbox",
            detail: "Running identity reconciliation",
          },
        },
        "Sandbox: identity reconciliation running",
        "sandbox",
        at,
      );
    case "reconcile.done":
      return pushLog(
        {
          ...activity,
          subagents: Object.fromEntries(
            Object.entries(activity.subagents).map(([systemId, subagent]) => [
              systemId,
              {
                ...subagent,
                status: subagent.status === "failed" ? "failed" : "done",
              },
            ]),
          ),
          sandbox: {
            active: false,
            label: "Sandbox",
            detail: `Reconcile done — ${Number(event.clusters ?? 0)} clusters, ${Number(event.unknown ?? 0)} unknown`,
          },
        },
        `Sandbox finished — ${Number(event.clusters ?? 0)} clusters, ${Number(event.unknown ?? 0)} unattributed`,
        "sandbox",
        at,
      );
    case "cards.persisted":
      return pushLog(activity, `${Number(event.cardCount ?? 0)} approval cards ready`, "info", at);
    case "scan.completed":
      return pushLog(
        {
          ...activity,
          status: "completed",
          sandbox: { ...activity.sandbox, active: false },
          grantsDiscovered:
            event.grantsDiscovered != null
              ? Number(event.grantsDiscovered)
              : activity.grantsDiscovered,
          ...(event.costs
            ? {
                costs: {
                  inputTokens: Number((event.costs as { inputTokens?: number }).inputTokens ?? 0),
                  outputTokens: Number(
                    (event.costs as { outputTokens?: number }).outputTokens ?? 0,
                  ),
                  costUsd: Number((event.costs as { costUsd?: number }).costUsd ?? 0),
                  hardCapUsd: Number((event.costs as { hardCapUsd?: number }).hardCapUsd ?? 0),
                  capped: Boolean((event.costs as { capped?: boolean }).capped),
                },
              }
            : {}),
        },
        "Scan complete",
        "info",
        at,
      );
    case "scan.cost_capped":
      return pushLog(
        {
          ...activity,
          status: "cost_capped",
          error: String(event.error ?? "Spend cap reached"),
          errorKind: String(event.errorKind ?? "cost_capped"),
          recovery: recoveryFor(
            "cost_capped",
            event.recovery != null ? String(event.recovery) : null,
          ),
          sandbox: { ...activity.sandbox, active: false },
          ...(event.costs
            ? {
                costs: {
                  inputTokens: Number((event.costs as { inputTokens?: number }).inputTokens ?? 0),
                  outputTokens: Number(
                    (event.costs as { outputTokens?: number }).outputTokens ?? 0,
                  ),
                  costUsd: Number((event.costs as { costUsd?: number }).costUsd ?? 0),
                  hardCapUsd: Number((event.costs as { hardCapUsd?: number }).hardCapUsd ?? 0),
                  capped: true,
                },
              }
            : {}),
        },
        String(event.error ?? "Spend cap reached — scan stopped cleanly"),
        "warn",
        at,
      );
    case "cost.update":
      return {
        ...activity,
        costs: {
          inputTokens: Number(event.inputTokens ?? 0),
          outputTokens: Number(event.outputTokens ?? 0),
          costUsd: Number(event.costUsd ?? 0),
          hardCapUsd: Number(event.hardCapUsd ?? 0),
          capped: Boolean(event.capped),
        },
      };
    case "scan.partial":
      return pushLog(
        {
          ...activity,
          status: "partial",
          error: String(event.error ?? "Partial scan"),
          errorKind: "partial",
          recovery: recoveryFor("partial", event.recovery != null ? String(event.recovery) : null),
          sandbox: { ...activity.sandbox, active: false },
          grantsDiscovered:
            event.grantsDiscovered != null
              ? Number(event.grantsDiscovered)
              : activity.grantsDiscovered,
          ...(event.costs
            ? {
                costs: {
                  inputTokens: Number((event.costs as { inputTokens?: number }).inputTokens ?? 0),
                  outputTokens: Number(
                    (event.costs as { outputTokens?: number }).outputTokens ?? 0,
                  ),
                  costUsd: Number((event.costs as { costUsd?: number }).costUsd ?? 0),
                  hardCapUsd: Number((event.costs as { hardCapUsd?: number }).hardCapUsd ?? 0),
                  capped: Boolean((event.costs as { capped?: boolean }).capped),
                },
              }
            : {}),
        },
        String(event.error ?? "Partial scan — some connectors failed"),
        "warn",
        at,
      );
    case "scan.failed": {
      const msg = String(event.error ?? "Scan failed");
      const kind = String(event.errorKind ?? classifyClientError(msg));
      return pushLog(
        {
          ...activity,
          status: "failed",
          error: msg,
          errorKind: kind,
          recovery: recoveryFor(kind, event.recovery != null ? String(event.recovery) : null),
          sandbox: { ...activity.sandbox, active: false },
        },
        msg,
        "warn",
        at,
      );
    }
    case "trueforge.event":
      return pushLog(
        activity,
        `Harness: ${String(event.eventType)}${event.detail ? ` — ${String(event.detail)}` : ""}`,
        "info",
        at,
      );
    default:
      return activity;
  }
}

export function useScanSession() {
  const [state, dispatch] = useReducer(reduce, {
    activity: emptyActivity(),
    cards: [],
    loading: false,
    error: null,
  });
  const unsubRef = useRef<(() => void) | null>(null);
  const activeScanIdRef = useRef<string | null>(null);
  const refreshAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      unsubRef.current?.();
      refreshAbortRef.current?.abort();
      activeScanIdRef.current = null;
    };
  }, []);

  async function refreshCards(scanId: string) {
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    try {
      const res = await fetchCards(scanId, controller.signal);
      if (activeScanIdRef.current !== scanId || controller.signal.aborted) return;
      dispatch({
        type: "cards",
        scanId,
        cards: res.cards,
        status: res.status,
        costs: res.costs ?? null,
        driver: (res.driver as string | null) ?? null,
        recordingId: (res.recordingId as string | null) ?? null,
      });
    } catch (err) {
      if (!controller.signal.aborted && activeScanIdRef.current === scanId) {
        throw err;
      }
    } finally {
      if (refreshAbortRef.current === controller) {
        refreshAbortRef.current = null;
      }
    }
  }

  async function beginScan(person: string) {
    unsubRef.current?.();
    unsubRef.current = null;
    refreshAbortRef.current?.abort();
    refreshAbortRef.current = null;
    activeScanIdRef.current = null;
    dispatch({ type: "scan_starting", person });
    try {
      const started = await startScan({ person });
      dispatch({
        type: "scan_started",
        scanId: started.scanId,
        person,
        driver: started.driver,
        recordingId: started.recordingId ?? null,
      });
      activeScanIdRef.current = started.scanId;
      unsubRef.current = subscribeScanStream(started.scanId, {
        onEvent: (event) => {
          dispatch({ type: "event", event });
          if (
            event.type === "cards.persisted" ||
            event.type === "scan.completed" ||
            event.type === "scan.partial" ||
            event.type === "scan.cost_capped" ||
            event.type === "subagent.done" ||
            event.type === "subagent.failed"
          ) {
            void refreshCards(started.scanId);
          }
        },
      });
      // Initial poll in case events already finished
      void refreshCards(started.scanId);
    } catch (err) {
      dispatch({
        type: "scan_error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function updateCard(card: ApiCard) {
    dispatch({ type: "card_updated", card });
  }

  function dismissError() {
    dispatch({ type: "dismiss_error" });
  }

  return {
    ...state,
    beginScan,
    refreshCards,
    updateCard,
    dismissError,
  };
}
