import { describe, expect, it } from "vitest";

import { applyEvent, emptyActivity } from "./useScanSession.js";

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
});
