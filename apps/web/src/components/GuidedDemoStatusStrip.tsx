import type { GuidedDemoPhase, GuidedDemoState } from "../hooks/useGuidedDemo.js";

export function GuidedDemoStatusStrip({
  state,
  systemCount,
}: {
  state: GuidedDemoState;
  systemCount: number;
}) {
  if (state.phase === "idle") return null;

  const waiting = state.phase === "waiting";
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 border-t px-5 py-2.5 font-mono text-[11px] shadow-[0_-3px_12px_rgba(0,0,0,0.08)] ${
        waiting
          ? "border-[var(--color-irrev)] bg-[var(--color-irrev-soft)] text-[var(--color-irrev)]"
          : "border-[var(--color-line-strong)] bg-[var(--color-ink)] text-white"
      }`}
      aria-live="polite"
      aria-label={waiting ? "Waiting for human approval" : "Guided demo progress"}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 font-semibold uppercase tracking-[0.12em]">
            {waiting ? "Waiting for human approval" : "Demo mode"}
          </span>
          <span className="truncate opacity-85">
            {waiting ? "this decision is yours" : labelForPhase(state.phase, systemCount)}
          </span>
        </div>
        <span className="shrink-0 whitespace-nowrap opacity-75">
          step {state.step} of {state.totalSteps}
        </span>
      </div>
    </div>
  );
}

function labelForPhase(phase: GuidedDemoPhase, systemCount: number): string {
  switch (phase) {
    case "scanning":
      return `Fanning out across ${systemCount} systems`;
    case "reconciling":
      return "Reconciling identities in sandbox";
    case "headline":
      return "Queue ready";
    case "approving":
      return "Approving safe grants";
    case "holding":
      return "Recording the human hold";
    case "executing":
      return "Executing approved grants";
    case "verifying":
      return "Verifying the audit ledger";
    case "ledger":
      return "Audit ledger verified";
    case "stopped":
      return "Take stopped";
    case "error":
      return "Take failed";
    default:
      return "Guided demo ready";
  }
}
