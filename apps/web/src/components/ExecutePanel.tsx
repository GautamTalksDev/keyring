import { useState } from "react";

import { executeScan } from "../api/client.js";
import type { ApiCard, ExecuteResult } from "../api/types.js";
import {
  actionVerb,
  principalLabel,
  systemLabel,
} from "../lib/format.js";

export function ExecutePanel({
  scanId,
  cards,
  onClose,
  onFinished,
}: {
  scanId: string;
  cards: ApiCard[];
  onClose: () => void;
  onFinished: () => void;
}) {
  const [phase, setPhase] = useState<"confirm" | "running" | "done">("confirm");
  const [dryRun, setDryRun] = useState(true);
  const [results, setResults] = useState<ExecuteResult[]>([]);
  const [summary, setSummary] = useState<{
    dryRun: boolean;
    executed: number;
    failed: number;
    skipped: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const permanent = cards.filter((c) => c.irreversible);
  const restorable = cards.filter(
    (c) => !c.irreversible && c.grant.revocable.possible,
  );
  const executable = cards.filter((c) => c.proposedAction.kind !== "flag_only");

  async function run() {
    setPhase("running");
    setError(null);
    try {
      const res = await executeScan(scanId, "operator", dryRun);
      setResults(res.results);
      setSummary({
        dryRun: res.dryRun,
        executed: res.executed,
        failed: res.failed,
        skipped: res.skipped,
      });
      setPhase("done");
      onFinished();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("confirm");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="execute-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col border border-[var(--color-ink)] bg-white">
        <header className="shrink-0 border-b border-[var(--color-line)] px-5 py-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-faint)]">
            Execute step
          </div>
          <h2 id="execute-title" className="mt-1 text-[16px] font-semibold tracking-tight">
            {phase === "confirm"
              ? dryRun
                ? "Confirm dry-run"
                : "Confirm live execution"
              : phase === "running"
                ? dryRun
                  ? "Dry-running…"
                  : "Executing…"
                : "Execution complete"}
          </h2>
          <p className="mt-1 text-[12px] text-[var(--color-mute)]">
            Approving only recorded intent. This step applies changes — dry-run
            is on by default so clones cannot revoke by accident.
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {phase === "confirm" ? (
            <>
              <label className="mb-4 flex cursor-pointer items-start gap-2 border border-[var(--color-line)] px-3 py-2.5 text-[12px]">
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-ink)]"
                />
                <span>
                  <span className="font-semibold text-[var(--color-ink)]">
                    Dry-run
                  </span>
                  <span className="text-[var(--color-mute)]">
                    {" "}
                    — walk the path and write ledger entries without calling
                    mutating APIs. Uncheck only when you intend to revoke for
                    real.
                  </span>
                </span>
              </label>

              <p className="text-[13px] leading-relaxed text-[var(--color-ink-2)]">
                About to {dryRun ? "simulate" : "run"}{" "}
                <strong className="font-semibold">{executable.length}</strong>{" "}
                approved action
                {executable.length === 1 ? "" : "s"}
                {permanent.length > 0 ? (
                  <>
                    , including{" "}
                    <strong className="font-semibold text-[var(--color-irrev)]">
                      {permanent.length} permanent
                    </strong>
                  </>
                ) : null}
                {restorable.length > 0 ? (
                  <>
                    {" "}
                    · {restorable.length} restorable
                  </>
                ) : null}
                .
              </p>
              <ul className="mt-4 space-y-2">
                {cards.map((c) => (
                  <li
                    key={c.id}
                    className="border border-[var(--color-line)] px-3 py-2 text-[12px]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">{principalLabel(c)}</div>
                        <div className="text-[var(--color-mute)]">
                          {actionVerb(c.proposedAction.kind)} ·{" "}
                          {systemLabel(c.grant.system)} ·{" "}
                          {c.grant.resource.displayName}
                        </div>
                      </div>
                      {c.irreversible ? (
                        <span className="shrink-0 border border-[var(--color-irrev)] px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-irrev)]">
                          Permanent
                        </span>
                      ) : c.grant.revocable.possible ? (
                        <span className="shrink-0 border border-[var(--color-line-strong)] px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-mute)]">
                          Restorable
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
              {error ? (
                <div className="mt-3 border border-[var(--color-irrev)] bg-[var(--color-irrev-soft)] px-3 py-2 text-[12px] text-[var(--color-irrev)]">
                  <div className="font-semibold">Execution failure</div>
                  <p className="mt-0.5 text-[var(--color-ink-2)]">{error}</p>
                  <p className="mt-1.5 text-[var(--color-mute)]">
                    Recovery: Confirm dry-run vs live intent, check connector
                    write credentials, then retry.
                  </p>
                </div>
              ) : null}
            </>
          ) : null}

          {phase === "running" ? (
            <p className="font-mono text-[12px] text-[var(--color-mute)]">
              Writing audit records before and after each attempt…
            </p>
          ) : null}

          {phase === "done" && summary ? (
            <>
              <p className="text-[13px]">
                {summary.dryRun ? "Dry-run " : ""}
                Executed {summary.executed} · Failed {summary.failed} · Skipped{" "}
                {summary.skipped}
              </p>
              <ul className="mt-4 space-y-1.5 font-mono text-[12px]">
                {results.map((r) => (
                  <li
                    key={r.cardId}
                    className="flex justify-between gap-2 border-b border-[var(--color-line)] py-1.5"
                  >
                    <span className="truncate text-[var(--color-mute)]">
                      {r.cardId.slice(0, 12)}…
                      {r.restorable === true
                        ? " · restorable"
                        : r.restorable === false
                          ? " · permanent"
                          : ""}
                    </span>
                    <span
                      className={
                        r.status === "success" || r.status === "dry_run"
                          ? "text-[var(--color-ok)]"
                          : r.status === "failed"
                            ? "text-[var(--color-irrev)]"
                            : "text-[var(--color-faint)]"
                      }
                    >
                      {r.status}
                      {r.detail ? ` — ${r.detail}` : r.error ? ` — ${r.error}` : ""}
                      {r.status === "failed" && r.recovery ? (
                        <span className="block text-[10px] text-[var(--color-mute)]">
                          Recovery: {r.recovery}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-[var(--color-line)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="border border-[var(--color-line-strong)] px-3 py-1.5 text-[12px] font-medium"
          >
            {phase === "done" ? "Close" : "Cancel"}
          </button>
          {phase === "confirm" ? (
            <button
              type="button"
              onClick={() => void run()}
              className={
                dryRun
                  ? "border border-[var(--color-ink)] bg-[var(--color-ink)] px-3 py-1.5 text-[12px] font-semibold text-white"
                  : "border border-[var(--color-irrev)] bg-[var(--color-irrev)] px-3 py-1.5 text-[12px] font-semibold text-white"
              }
            >
              {dryRun ? "Run dry-run" : "Confirm live execute"}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
