import type { AgentActivityState } from "../api/types.js";

export function AgentActivity({
  activity,
  onStart,
  busy,
}: {
  activity: AgentActivityState;
  onStart: (person: string) => void;
  busy: boolean;
}) {
  const subagents = Object.values(activity.subagents).sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-panel)]">
      <header className="shrink-0 border-b border-[var(--color-line)] px-5 py-4">
        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-faint)]">
          Agent activity
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-ink)]">
            Live scan
          </h2>
          <StatusPill status={activity.status} />
        </div>
        {activity.person ? (
          <p className="mt-1 font-mono text-[12px] text-[var(--color-mute)]">
            {activity.person}
          </p>
        ) : null}
      </header>

      {activity.status === "idle" ? (
        <StartForm onStart={onStart} busy={busy} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {activity.sandbox.active || activity.sandbox.detail ? (
            <div
              className={`mx-4 mt-4 border px-3 py-2.5 ${
                activity.sandbox.active
                  ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                  : "border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-ink)]"
              }`}
            >
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.06em]">
                <span
                  className={`inline-block h-1.5 w-1.5 ${
                    activity.sandbox.active
                      ? "animate-pulse bg-white"
                      : "bg-[var(--color-mute)]"
                  }`}
                />
                Sandbox
                {activity.sandbox.active ? " · running code" : " · idle"}
              </div>
              {activity.sandbox.detail ? (
                <p className="mt-1 text-[12px] leading-snug opacity-90">
                  {activity.sandbox.detail}
                </p>
              ) : null}
            </div>
          ) : null}

          <section className="px-4 pt-4">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-faint)]">
              Subagents
            </h3>
            <ul className="mt-2 space-y-1">
              {subagents.length === 0 ? (
                <li className="py-2 text-[12px] text-[var(--color-faint)]">
                  Waiting for systems…
                </li>
              ) : (
                subagents.map((s) => (
                  <li
                    key={s.systemId}
                    className="flex items-center justify-between gap-2 border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium">
                        {s.displayName}
                      </div>
                      <div className="font-mono text-[11px] text-[var(--color-faint)]">
                        {s.systemId}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div
                        className={`text-[11px] font-medium uppercase tracking-wide ${
                          s.status === "running"
                            ? "text-[var(--color-ink)]"
                            : "text-[var(--color-ok)]"
                        }`}
                      >
                        {s.status === "running" ? "Scanning" : "Done"}
                      </div>
                      <div className="font-mono text-[12px] text-[var(--color-mute)]">
                        {s.found}
                      </div>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </section>

          <section className="mt-4 flex min-h-0 flex-1 flex-col border-t border-[var(--color-line)] px-4 pt-3">
            <h3 className="shrink-0 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-faint)]">
              Event log
            </h3>
            <ol className="mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto pb-4 font-mono text-[11px] leading-relaxed text-[var(--color-mute)]">
              {[...activity.log].reverse().map((line, i) => (
                <li
                  key={`${line.at}-${i}`}
                  className={
                    line.kind === "sandbox"
                      ? "text-[var(--color-ink)]"
                      : line.kind === "warn"
                        ? "text-[var(--color-irrev)]"
                        : undefined
                  }
                >
                  <span className="text-[var(--color-faint)]">
                    {new Date(line.at).toLocaleTimeString()}
                  </span>{" "}
                  {line.text}
                </li>
              ))}
            </ol>
          </section>

          {activity.status === "completed" ||
          activity.status === "failed" ||
          activity.status === "cost_capped" ||
          activity.status === "partial" ? (
            <div className="shrink-0 border-t border-[var(--color-line)] px-4 py-3">
              <StartForm onStart={onStart} busy={busy} compact />
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}

function StatusPill({ status }: { status: AgentActivityState["status"] }) {
  const label =
    status === "idle"
      ? "Idle"
      : status === "running"
        ? "Running"
        : status === "completed"
          ? "Complete"
          : status === "partial"
            ? "Partial"
            : status === "cost_capped"
              ? "Cap reached"
              : "Failed";
  return (
    <span
      className={`font-mono text-[11px] uppercase tracking-wide ${
        status === "cost_capped" || status === "partial" || status === "failed"
          ? "text-[var(--color-irrev)]"
          : "text-[var(--color-mute)]"
      }`}
    >
      {label}
    </span>
  );
}

function StartForm({
  onStart,
  busy,
  compact,
}: {
  onStart: (person: string) => void;
  busy: boolean;
  compact?: boolean;
}) {
  return (
    <form
      className={compact ? "flex gap-2" : "flex flex-1 flex-col justify-center px-5 py-8"}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const person = String(fd.get("person") ?? "").trim();
        if (person) onStart(person);
      }}
    >
      {!compact ? (
        <>
          <p className="text-[13px] leading-relaxed text-[var(--color-mute)]">
            Start an access audit. The agent fans out one subagent per connected
            system, reconciles identities in the sandbox, then fills the queue.
          </p>
          <label className="mt-6 block text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-faint)]">
            Person
          </label>
        </>
      ) : null}
      <input
        name="person"
        required
        placeholder="Ada Lovelace"
        defaultValue="Ada Lovelace"
        disabled={busy}
        className={`border border-[var(--color-line-strong)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-ink)] ${
          compact ? "min-w-0 flex-1" : "mt-1.5 w-full"
        }`}
      />
      <button
        type="submit"
        disabled={busy}
        className={`border border-[var(--color-ink)] bg-[var(--color-ink)] px-3 py-2 text-[13px] font-medium text-white hover:bg-[var(--color-ink-2)] disabled:opacity-50 ${
          compact ? "shrink-0" : "mt-3 w-full"
        }`}
      >
        {busy ? "Starting…" : compact ? "New scan" : "Start scan"}
      </button>
    </form>
  );
}
