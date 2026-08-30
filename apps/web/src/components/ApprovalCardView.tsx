import type { ReactNode } from "react";

import type { ApiCard } from "../api/types.js";
import {
  actionVerb,
  confidenceLabel,
  formatWhen,
  principalLabel,
  staleness,
  systemLabel,
} from "../lib/format.js";

export function ApprovalCardView({
  card,
  selected,
  focused,
  checked,
  onFocus,
  onToggleCheck,
  onApprove,
  onHold,
  onReject,
  actionsDisabled = false,
}: {
  card: ApiCard;
  selected: boolean;
  focused: boolean;
  checked: boolean;
  onFocus: () => void;
  onToggleCheck: () => void;
  onApprove: () => void;
  onHold: () => void;
  onReject: () => void;
  actionsDisabled?: boolean;
}) {
  const stale = staleness(card.grant.lastUsedAt);
  const pending = card.status === "pending";
  const who = principalLabel(card);

  return (
    <article
      id={`approval-card-${card.id}`}
      role="listitem"
      tabIndex={0}
      onFocus={onFocus}
      onClick={onFocus}
      className={`border bg-[var(--color-panel)] outline-none transition-colors ${
        focused
          ? "border-[var(--color-ink)] ring-1 ring-[var(--color-ink)]"
          : "border-[var(--color-line)]"
      } ${selected ? "bg-[var(--color-surface-2)]" : ""}`}
    >
      <div className="flex items-start gap-3 px-3.5 py-3">
        <label className="mt-0.5 shrink-0 cursor-pointer" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={checked}
            disabled={!pending || actionsDisabled}
            onChange={onToggleCheck}
            className="h-3.5 w-3.5 accent-[var(--color-ink)]"
            aria-label={`Select ${who}`}
          />
        </label>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-[14px] font-semibold tracking-tight">{who}</h3>
                <ConfidenceBadge confidence={card.attribution.confidence} />
                {card.irreversible ? (
                  <span className="border border-[var(--color-irrev)] bg-[var(--color-irrev-soft)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-irrev)]">
                    Permanent
                  </span>
                ) : card.grant.revocable.possible ? (
                  <span className="border border-[var(--color-line-strong)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-mute)]">
                    Restorable
                  </span>
                ) : null}
                {card.protected ? (
                  <span
                    className="border border-[var(--color-hold)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-hold)]"
                    title={card.protectedReason ?? "Protected by keyring.yml"}
                  >
                    Protected
                  </span>
                ) : null}
                {card.autoApprovedBy ? (
                  <span
                    className="border border-[var(--color-ok)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ok)]"
                    title={card.decision?.note ?? undefined}
                  >
                    Auto: {card.autoApprovedBy}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-[12px] text-[var(--color-mute)]">
                <span className="font-medium text-[var(--color-ink-2)]">
                  {systemLabel(card.grant.system)}
                </span>
                {" · "}
                <span className="font-mono">{card.grant.capability}</span>
                {" on "}
                <span className="font-medium">{card.grant.resource.displayName}</span>
              </p>
            </div>

            <div className="shrink-0 text-right">
              <div className="font-mono text-[18px] font-semibold leading-none tracking-tight">
                {card.risk.score}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-[var(--color-faint)]">
                Risk
              </div>
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
            <Meta
              label="Created"
              value={formatWhen(card.grant.createdAt ?? card.grant.discoveredAt)}
            />
            <Meta
              label="Last used"
              value={
                <span
                  className={
                    stale.level === "critical" || stale.level === "unknown"
                      ? "font-medium text-[var(--color-irrev)]"
                      : stale.level === "stale"
                        ? "font-medium text-[var(--color-hold)]"
                        : "text-[var(--color-mute)]"
                  }
                >
                  {card.grant.lastUsedAt
                    ? `${formatWhen(card.grant.lastUsedAt)} · ${stale.label}`
                    : stale.label}
                </span>
              }
            />
            <Meta
              label="Action"
              value={
                <span className="font-medium">
                  {actionVerb(card.proposedAction.kind)}
                  {card.status !== "pending" ? (
                    <span className="ml-1.5 font-normal text-[var(--color-faint)]">
                      · {card.status}
                    </span>
                  ) : null}
                </span>
              }
            />
          </div>

          <p className="mt-2.5 text-[12px] leading-relaxed text-[var(--color-ink-2)]">
            {card.attribution.reasoning}
          </p>

          <ul className="mt-2 space-y-0.5 border-t border-[var(--color-line)] pt-2">
            {card.risk.reasons.map((r) => (
              <li key={r} className="font-mono text-[11px] leading-snug text-[var(--color-mute)]">
                {r}
              </li>
            ))}
          </ul>

          {pending && !actionsDisabled ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              <ActionButton onClick={onApprove} variant="primary">
                Approve
              </ActionButton>
              <ActionButton onClick={onHold} variant="ghost">
                Hold
              </ActionButton>
              <ActionButton onClick={onReject} variant="ghost">
                Reject
              </ActionButton>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  return (
    <span className="border border-[var(--color-line-strong)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--color-mute)]">
      {confidenceLabel(confidence)}
    </span>
  );
}

function Meta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-[0.06em] text-[var(--color-faint)]">
        {label}
      </span>{" "}
      <span className="text-[var(--color-ink-2)]">{value}</span>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  variant,
}: {
  children: ReactNode;
  onClick: () => void;
  variant: "primary" | "ghost";
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={
        variant === "primary"
          ? "border border-[var(--color-ink)] bg-[var(--color-ink)] px-2.5 py-1 text-[12px] font-medium text-white hover:bg-[var(--color-ink-2)]"
          : "border border-[var(--color-line-strong)] bg-white px-2.5 py-1 text-[12px] font-medium text-[var(--color-ink)] hover:border-[var(--color-ink)]"
      }
    >
      {children}
    </button>
  );
}
