import { AgentActivity } from "./components/AgentActivity.js";
import { ApprovalQueue } from "./components/ApprovalQueue.js";
import { ErrorBanner } from "./components/ErrorBanner.js";
import { useScanSession } from "./hooks/useScanSession.js";
import { classifyClientError, recoveryFor, type ProductErrorKind } from "./lib/errors.js";

export function App() {
  const session = useScanSession();
  const costs = session.activity.costs;
  const capped = session.activity.status === "cost_capped";
  const partial = session.activity.status === "partial";
  const showBanner = Boolean(session.error) || capped || partial || Boolean(session.activity.error);

  const kind = (session.activity.errorKind ??
    (capped
      ? "cost_capped"
      : partial
        ? "partial"
        : session.error || session.activity.error
          ? classifyClientError(session.error ?? session.activity.error ?? "")
          : null)) as ProductErrorKind | null;

  const message =
    session.activity.error ??
    session.error ??
    (capped
      ? "Spend cap reached. The scan stopped cleanly — no further model calls."
      : partial
        ? "Some connectors failed; results below are incomplete."
        : "");

  const recovery = session.activity.recovery ?? (kind ? recoveryFor(kind) : null);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-panel)] px-5 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-[15px] font-semibold tracking-tight">Keyring</span>
          <span className="text-[12px] text-[var(--color-faint)]">Access governance</span>
        </div>
        <div className="font-mono text-[11px] text-[var(--color-faint)]">
          {session.activity.scanId
            ? `scan ${session.activity.scanId.slice(0, 8)}`
            : "no active scan"}
          {session.activity.driver ? ` · ${session.activity.driver}` : ""}
        </div>
      </header>

      {showBanner && message ? (
        <ErrorBanner
          kind={kind}
          message={message}
          recovery={recovery}
          onDismiss={session.dismissError}
          onRetry={
            session.activity.person
              ? () => void session.beginScan(session.activity.person!)
              : undefined
          }
        />
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(280px,340px)_1fr]">
        <AgentActivity
          activity={session.activity}
          busy={session.loading}
          onStart={(person) => void session.beginScan(person)}
        />
        <ApprovalQueue
          cards={session.cards}
          systemIds={Object.keys(session.activity.subagents)}
          scanId={session.activity.scanId}
          scanStatus={session.activity.status}
          onCardUpdated={session.updateCard}
        />
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] bg-[var(--color-panel)] px-5 py-2 font-mono text-[11px] text-[var(--color-mute)]">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>
            tokens{" "}
            <strong className="font-medium text-[var(--color-ink)]">
              {costs
                ? `${costs.inputTokens.toLocaleString()} in / ${costs.outputTokens.toLocaleString()} out`
                : "—"}
            </strong>
          </span>
          <span>
            cost{" "}
            <strong className="font-medium text-[var(--color-ink)]">
              {costs ? `$${costs.costUsd.toFixed(4)}` : "—"}
            </strong>
            {costs ? (
              <span className="text-[var(--color-faint)]">
                {" "}
                / cap ${costs.hardCapUsd.toFixed(2)}
              </span>
            ) : null}
          </span>
        </div>
        <div className="text-[var(--color-faint)]">
          {session.activity.recordingId
            ? `recording ${session.activity.recordingId}`
            : "live accounting"}
          {" · "}
          keys never leave the server env
        </div>
      </footer>
    </div>
  );
}
