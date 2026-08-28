import type { ApiCard } from "../api/types.js";
import { actionVerb, principalLabel, systemLabel } from "../lib/format.js";

export function HoldDialog({
  card,
  onCancel,
  onConfirm,
}: {
  card: ApiCard;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hold-title"
    >
      <form
        className="w-full max-w-md border border-[var(--color-ink)] bg-white p-5 shadow-none"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const note = String(fd.get("note") ?? "").trim();
          if (note) onConfirm(note);
        }}
      >
        <h2 id="hold-title" className="text-[15px] font-semibold tracking-tight">
          Hold decision
        </h2>
        <p className="mt-1 text-[12px] text-[var(--color-mute)]">
          {principalLabel(card)} · {systemLabel(card.grant.system)} ·{" "}
          {actionVerb(card.proposedAction.kind)}
        </p>
        <label className="mt-4 block text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-faint)]">
          Note (required)
        </label>
        <textarea
          name="note"
          required
          rows={3}
          autoFocus
          placeholder="Why are we holding this?"
          className="mt-1.5 w-full border border-[var(--color-line-strong)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-ink)]"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="border border-[var(--color-line-strong)] px-3 py-1.5 text-[12px] font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="border border-[var(--color-ink)] bg-[var(--color-ink)] px-3 py-1.5 text-[12px] font-medium text-white"
          >
            Hold
          </button>
        </div>
      </form>
    </div>
  );
}
