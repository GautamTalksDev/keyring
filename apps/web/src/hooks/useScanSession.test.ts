import { describe, expect, it } from "vitest";

import type { ApiCard } from "../api/types.js";
import { applyEvent, emptyActivity, reduce, type ScanSessionState } from "./useScanSession.js";

const event = (type: string, systemId?: string) => ({
  type,
  scanId: "scan-1",
  at: "2026-08-29T00:00:00.000Z",
  ...(systemId ? { systemId, displayName: systemId } : {}),
});

describe("scan session activity reducer", () => {
  it("keeps failed subagents failed while successful siblings reconcile", () => {
    let activity = emptyActivity();
    activity = applyEvent(activity, event("subagent.queued", "failed-system"));
    activity = applyEvent(activity, event("subagent.queued", "healthy-system"));
    activity = applyEvent(activity, event("subagent.started", "failed-system"));
    activity = applyEvent(activity, event("subagent.started", "healthy-system"));
    activity = applyEvent(activity, {
      ...event("subagent.failed", "failed-system"),
      error: "Connector unavailable",
    });
    activity = applyEvent(activity, event("subagent.done", "healthy-system"));

    const duringReconcile = applyEvent(activity, event("reconcile.started"));
    expect(duringReconcile.subagents["failed-system"]?.status).toBe("failed");
    expect(duringReconcile.subagents["healthy-system"]?.status).toBe("reconciling");

    const afterReconcile = applyEvent(duringReconcile, {
      ...event("reconcile.done"),
      clusters: 1,
      unknown: 0,
    });
    expect(afterReconcile.subagents["failed-system"]?.status).toBe("failed");
    expect(afterReconcile.subagents["healthy-system"]?.status).toBe("done");
  });

  it("discards a previous scan's card refresh after a new scan starts", () => {
    const oldCard = { id: "old-card" } as ApiCard;
    const newCard = { id: "new-card" } as ApiCard;
    let state: ScanSessionState = {
      activity: emptyActivity(),
      cards: [] as ApiCard[],
      loading: false,
      error: null,
    };

    state = reduce(state, { type: "scan_starting", person: "Ada Lovelace" });
    state = reduce(state, {
      type: "scan_started",
      scanId: "scan-1",
      person: "Ada Lovelace",
    });
    const staleRefresh = {
      type: "cards" as const,
      scanId: "scan-1",
      cards: [oldCard],
      status: "completed",
    };
    state = reduce(state, { type: "scan_starting", person: "Grace Hopper" });
    state = reduce(state, {
      type: "scan_started",
      scanId: "scan-2",
      person: "Grace Hopper",
    });

    const staleResult = reduce(state, staleRefresh);
    expect(staleResult.cards).toEqual([]);
    expect(staleResult.activity.status).toBe("running");

    const currentResult = reduce(staleResult, {
      type: "cards",
      scanId: "scan-2",
      cards: [newCard],
      status: "completed",
    });
    expect(currentResult.cards).toEqual([newCard]);
    expect(currentResult.activity.status).toBe("completed");

    const lateStaleResult = reduce(currentResult, staleRefresh);
    expect(lateStaleResult.cards).toEqual([newCard]);
    expect(lateStaleResult.activity.status).toBe("completed");
  });
});
