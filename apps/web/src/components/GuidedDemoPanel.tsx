import type { ApiCard, AuditRecord, AuditVerification, ExecuteResult } from "../api/types.js";
import { actionVerb, principalLabel, systemLabel } from "../lib/format.js";
import type { GuidedDemoPhase, GuidedDemoState } from "../hooks/useGuidedDemo.js";

export function GuidedDemoPanel({
  state,
  cards,
  onContinue,
  onStop,
}: {
  state: GuidedDemoState;
  cards: ApiCard[];
  onContinue: () => void;
  onStop: () => void;
}) {
  const target = state.targetCardId
    ? cards.find((card) => card.id === state.targetCardId)
    : undefined;
  const active =
    state.phase !== "idle" &&
    state.phase !== "stopped" &&
    state.phase !== "error" &&
    state.phase !== "ledger";

  return (
    <aside
      className="fixed right-5 top-[4.25rem] z-30 w-[min(390px,calc(100vw-2.5rem))] border border-[var(--color-ink)] bg-white shadow-lg"
      aria-live="polite"
      aria-label="Guided demo status"
    >
      <header className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] bg-[var(--color-ink)] px-4 py-3 text-white">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/65">
            Guided demo
          </div>
          <h2 className="mt-0.5 text-[14px] font-semibold">{titleForPhase(state.phase)}</h2>
        </div>
        {active ? (
          <button
            type="button"
            onClick={onStop}
            className="border border-white/50 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white hover:text-[var(--color-ink)]"
          >
            Stop
          </button>
        ) : null}
      </header>

      <div className="max-h-[calc(100vh-8rem)] overflow-y-auto px-4 py-3">
        {state.message ? (
          <p className="text-[12px] leading-relaxed text-[var(--color-ink-2)]">{state.message}</p>
        ) : null}

        {state.phase === "waiting" && target ? (
          <div className="mt-3 border-2 border-[var(--color-hold)] bg-[#fffaf0] px-3 py-3">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-hold)]">
              Human approval gate
            </div>
            <h3 className="mt-1 text-[14px] font-semibold">{principalLabel(target)}</h3>
            <p className="mt-0.5 text-[12px] text-[var(--color-mute)]">
              {systemLabel(target.grant.system)} · {target.grant.resource.displayName} ·{" "}
              {actionVerb(target.proposedAction.kind)}
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--color-ink-2)]">
              {target.protectedReason ?? "Protected CI infrastructure."}
            </p>
            <p className="mt-2 font-mono text-[11px] text-[var(--color-hold)]">
              The run is paused. Do not decide this card from the queue.
            </p>
            <button
              type="button"
              onClick={onContinue}
              className="mt-3 w-full border border-[var(--color-ink)] bg-[var(--color-ink)] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[var(--color-ink-2)]"
            >
              Continue
            </button>
          </div>
        ) : null}

        {state.error ? (
          <div className="mt-3 border border-[var(--color-irrev)] bg-[var(--color-irrev-soft)] px-3 py-2 text-[12px] text-[var(--color-irrev)]">
            {state.error}
          </div>
        ) : null}

        {state.phase === "executing" || state.phase === "verifying" ? (
          <ResultList results={state.results} cards={cards} />
        ) : null}

        {state.phase === "ledger" ? (
          <Ledger
            records={state.auditRecords}
            verification={state.verification}
            cards={cards}
            results={state.results}
          />
        ) : null}
      </div>
    </aside>
  );
}

function titleForPhase(phase: GuidedDemoPhase): string {
  switch (phase) {
    case "scanning":
      return "Scanning systems";
    case "headline":
      return "Queue ready";
    case "approving":
      return "Approving safe cards";
    case "waiting":
      return "Approval required";
    case "holding":
      return "Recording human hold";
    case "executing":
      return "Executing approved cards";
    case "verifying":
      return "Verifying ledger";
    case "ledger":
      return "Audit ledger";
    case "stopped":
      return "Take stopped";
    case "error":
      return "Take failed";
    default:
      return "Ready";
  }
}

function ResultList({ results, cards }: { results: ExecuteResult[]; cards: ApiCard[] }) {
  if (results.length === 0) {
    return (
      <p className="mt-3 font-mono text-[11px] text-[var(--color-faint)]">Waiting for results…</p>
    );
  }
  return (
    <div className="mt-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-faint)]">
        Per-card results
      </div>
      <ul className="mt-1.5 space-y-1">
        {results.map((result) => {
          const card = cards.find((candidate) => candidate.id === result.cardId);
          return (
            <li
              key={result.cardId}
              className="flex items-start justify-between gap-2 border-b border-[var(--color-line)] py-1.5 text-[11px]"
            >
              <span className="min-w-0 truncate text-[var(--color-mute)]">
                {card ? principalLabel(card) : `${result.cardId.slice(0, 10)}…`}
              </span>
              <span
                className={
                  result.status === "failed"
                    ? "shrink-0 text-[var(--color-irrev)]"
                    : "shrink-0 text-[var(--color-ok)]"
                }
              >
                {result.status}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Ledger({
  records,
  verification,
  cards,
  results,
}: {
  records: AuditRecord[];
  verification: AuditVerification | null;
  cards: ApiCard[];
  results: ExecuteResult[];
}) {
  const passing = verification?.ok === true;
  return (
    <div className="mt-3">
      <div
        className={`border px-3 py-2 ${
          passing
            ? "border-[var(--color-ok)] bg-[#f2fbf4] text-[var(--color-ok)]"
            : "border-[var(--color-irrev)] bg-[var(--color-irrev-soft)] text-[var(--color-irrev)]"
        }`}
      >
        <div className="text-[12px] font-semibold">
          {passing ? "Hash verification passing" : "Hash verification failed"}
        </div>
        <div className="mt-0.5 font-mono text-[10px]">
          {verification?.count ?? records.length} ledger record
          {(verification?.count ?? records.length) === 1 ? "" : "s"}
        </div>
      </div>
      <ResultList results={results} cards={cards} />
      <ol className="mt-3 space-y-1 border-t border-[var(--color-line)] pt-2">
        {records.slice(-8).map((record) => (
          <li
            key={record.id}
            className="flex items-center justify-between gap-2 font-mono text-[10px]"
          >
            <span className="truncate text-[var(--color-mute)]">
              {record.action} · {record.cardId.slice(0, 10)}…
            </span>
            <span
              className={
                record.result === "failed" ? "text-[var(--color-irrev)]" : "text-[var(--color-ok)]"
              }
            >
              {record.result}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
