import { useEffect, useMemo, useRef, useState } from "react";

import { postDecision } from "../api/client.js";
import type { ApiCard } from "../api/types.js";
import { countScanSummary, queueSections, scanSummaryText } from "../lib/format.js";
import { ApprovalCardView } from "./ApprovalCardView.js";
import { ExecutePanel } from "./ExecutePanel.js";
import { HoldDialog } from "./HoldDialog.js";

interface RingRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TravellingRing {
  key: string;
  rect: RingRect;
  travelling: boolean;
}

function toRingRect(rect: DOMRect): RingRect {
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

export function ApprovalQueue({
  cards,
  systemIds,
  scanId,
  scanStatus,
  onCardUpdated,
  guidedMode = false,
  guidedCardId = null,
}: {
  cards: ApiCard[];
  systemIds: string[];
  scanId: string | null;
  scanStatus: string;
  onCardUpdated: (card: ApiCard) => void;
  guidedMode?: boolean;
  guidedCardId?: string | null;
}) {
  const {
    unattributed,
    agents,
    attributed,
    visualOrder: ordered,
  } = useMemo(() => queueSections(cards), [cards]);

  const [focusIndex, setFocusIndex] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [holdTarget, setHoldTarget] = useState<ApiCard | null>(null);
  const [executeOpen, setExecuteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [travellingRing, setTravellingRing] = useState<TravellingRing | null>(null);
  const previousGuidedCardId = useRef<string | null>(null);

  const focusable = ordered.filter((c) => c.status === "pending");
  const focused = focusable[Math.min(focusIndex, Math.max(0, focusable.length - 1))];

  useEffect(() => {
    setFocusIndex(0);
  }, [scanId]);

  useEffect(() => {
    if (!guidedCardId) {
      previousGuidedCardId.current = null;
      setTravellingRing(null);
      return;
    }
    const target = document.getElementById(`approval-card-${guidedCardId}`);
    if (!target) return;
    const reducedMotion =
      typeof window === "undefined" ||
      !window.matchMedia ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });

    const targetRect = toRingRect(target.getBoundingClientRect());
    const previous = previousGuidedCardId.current
      ? document.getElementById(`approval-card-${previousGuidedCardId.current}`)
      : null;
    const startRect = previous ? toRingRect(previous.getBoundingClientRect()) : targetRect;
    previousGuidedCardId.current = guidedCardId;

    if (reducedMotion) {
      setTravellingRing(null);
      return;
    }
    const key = `${guidedCardId}-${Date.now()}`;
    setTravellingRing({ key, rect: startRect, travelling: false });
    const animationFrame = requestAnimationFrame(() => {
      setTravellingRing((current) =>
        current?.key === key ? { key, rect: targetRect, travelling: true } : current,
      );
    });
    const cleanup = window.setTimeout(() => {
      setTravellingRing((current) => (current?.key === key ? null : current));
    }, 360);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.clearTimeout(cleanup);
    };
  }, [guidedCardId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!focusable.length) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIndex((i) => Math.min(i + 1, focusable.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "a" && focused) {
        e.preventDefault();
        void decide(focused, "approve");
      } else if (e.key === "h" && focused) {
        e.preventDefault();
        setHoldTarget(focused);
      } else if (e.key === "r" && focused) {
        e.preventDefault();
        void decide(focused, "reject");
      } else if (e.key === "x" && focused) {
        e.preventDefault();
        toggleCheck(focused.id);
      } else if (e.key === " " && focused) {
        e.preventDefault();
        toggleCheck(focused.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function bulk(decision: "approve" | "reject") {
    const targets = ordered.filter((c) => checked.has(c.id) && c.status === "pending");
    const protectedSkipped =
      decision === "approve" ? targets.filter((c) => c.protected === true) : [];
    const runnable = decision === "approve" ? targets.filter((c) => c.protected !== true) : targets;
    for (const card of runnable) {
      await decide(card, decision, undefined, decision === "approve");
    }
    if (protectedSkipped.length > 0) {
      window.alert(
        `${protectedSkipped.length} protected card(s) skipped — keyring.yml requires individual approval.`,
      );
    }
  }

  async function decide(
    card: ApiCard,
    decision: "approve" | "hold" | "reject",
    note?: string,
    bulk = false,
  ) {
    if (card.status !== "pending" || busy) return;
    if (bulk && decision === "approve" && card.protected) return;
    setBusy(true);
    try {
      const res = await postDecision(card.id, {
        decision,
        note,
        ...(bulk ? { bulk: true } : {}),
      });
      onCardUpdated(res.card);
      setChecked((prev) => {
        const next = new Set(prev);
        next.delete(card.id);
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  function toggleCheck(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const approved = ordered.filter((c) => c.status === "approved");
  const pendingCount = ordered.filter((c) => c.status === "pending").length;
  const heldCount = ordered.filter((c) => c.status === "held").length;
  const summary = countScanSummary(cards, systemIds);

  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--color-surface)]">
      {travellingRing ? (
        <div
          key={travellingRing.key}
          aria-hidden="true"
          className="pointer-events-none fixed z-30 border-2 border-[var(--color-ink)]"
          style={{
            top: travellingRing.rect.top,
            left: travellingRing.rect.left,
            width: travellingRing.rect.width,
            height: travellingRing.rect.height,
            transition: travellingRing.travelling
              ? "top 300ms ease, left 300ms ease, width 300ms ease, height 300ms ease"
              : undefined,
          }}
        />
      ) : null}
      <header className="shrink-0 border-b border-[var(--color-line)] bg-[var(--color-panel)] px-6 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-faint)]">
              Approval queue
            </div>
            <h2 className="mt-1 text-[18px] font-semibold tracking-tight">Review access</h2>
            <p className="mt-1 text-[12px] text-[var(--color-mute)]">
              {pendingCount} pending · {heldCount} held · {approved.length} approved ·{" "}
              {ordered.length} total · <span className="font-mono">j/k</span> move ·{" "}
              <span className="font-mono">a/h/r</span> decide · <span className="font-mono">x</span>{" "}
              select
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!guidedMode && pendingCount > 0 && checked.size === 0 ? (
              <button
                type="button"
                className="border border-[var(--color-line-strong)] bg-white px-2.5 py-1.5 text-[12px] font-medium text-[var(--color-mute)] hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]"
                onClick={() =>
                  setChecked(
                    new Set(ordered.filter((c) => c.status === "pending").map((c) => c.id)),
                  )
                }
              >
                Select all pending
              </button>
            ) : null}
            {!guidedMode && checked.size > 0 ? (
              <>
                <span className="font-mono text-[12px] text-[var(--color-mute)]">
                  {checked.size} selected
                </span>
                <button
                  type="button"
                  className="border border-[var(--color-ink)] bg-[var(--color-ink)] px-2.5 py-1.5 text-[12px] font-medium text-white"
                  onClick={() => void bulk("approve")}
                >
                  Bulk approve
                </button>
                <button
                  type="button"
                  className="border border-[var(--color-line-strong)] bg-white px-2.5 py-1.5 text-[12px] font-medium"
                  onClick={() => void bulk("reject")}
                >
                  Bulk reject
                </button>
                <button
                  type="button"
                  className="px-2 py-1.5 text-[12px] text-[var(--color-faint)] hover:text-[var(--color-ink)]"
                  onClick={() => setChecked(new Set())}
                >
                  Clear
                </button>
              </>
            ) : null}
            {!guidedMode ? (
              <button
                type="button"
                disabled={!scanId || approved.length === 0}
                onClick={() => setExecuteOpen(true)}
                className="border border-[var(--color-ink)] bg-white px-3 py-1.5 text-[12px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-ink)] hover:text-white disabled:opacity-40"
              >
                Execute approved ({approved.length})
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {scanStatus === "completed" ? (
          <div
            aria-label={scanSummaryText(summary)}
            className="mx-auto mb-5 max-w-3xl border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3"
          >
            <p className="text-[13px] leading-relaxed text-[var(--color-ink-2)]">
              <span className="font-semibold text-[var(--color-ink)]">
                {scanSummaryText(summary)}
              </span>
            </p>
          </div>
        ) : null}
        {ordered.length === 0 ? (
          <EmptyState scanStatus={scanStatus} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-8">
            {unattributed.length > 0 ? (
              <div>
                <SectionHeading
                  title="Unattributed"
                  subtitle="Scariest findings — principal unresolved or speculative. Do not bury these."
                  tone="warn"
                  count={unattributed.length}
                />
                <div className="mt-3 space-y-2" role="list">
                  {unattributed.map((card) => (
                    <ApprovalCardView
                      key={card.id}
                      card={card}
                      selected={checked.has(card.id)}
                      focused={focused?.id === card.id}
                      checked={checked.has(card.id)}
                      onFocus={() =>
                        setFocusIndex(
                          Math.max(
                            0,
                            focusable.findIndex((c) => c.id === card.id),
                          ),
                        )
                      }
                      onToggleCheck={() => toggleCheck(card.id)}
                      onApprove={() => void decide(card, "approve")}
                      onHold={() => setHoldTarget(card)}
                      onReject={() => void decide(card, "reject")}
                      actionsDisabled={guidedMode}
                      guidedFocus={guidedCardId === card.id}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {agents.length > 0 ? (
              <div>
                <SectionHeading
                  title="AI agents"
                  subtitle="Non-human identities found in connected systems, including Keyring self-inventory."
                  tone="agent"
                  count={agents.length}
                />
                <div className="mt-3 space-y-2" role="list">
                  {agents.map((card) => (
                    <ApprovalCardView
                      key={card.id}
                      card={card}
                      selected={checked.has(card.id)}
                      focused={focused?.id === card.id}
                      checked={checked.has(card.id)}
                      onFocus={() =>
                        setFocusIndex(
                          Math.max(
                            0,
                            focusable.findIndex((c) => c.id === card.id),
                          ),
                        )
                      }
                      onToggleCheck={() => toggleCheck(card.id)}
                      onApprove={() => void decide(card, "approve")}
                      onHold={() => setHoldTarget(card)}
                      onReject={() => void decide(card, "reject")}
                      actionsDisabled={guidedMode}
                      guidedFocus={guidedCardId === card.id}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {attributed.length > 0 ? (
              <div>
                <SectionHeading
                  title="Attributed"
                  subtitle="Matched to a person or service account with stated confidence."
                  count={attributed.length}
                />
                <div className="mt-3 space-y-2" role="list">
                  {attributed.map((card) => (
                    <ApprovalCardView
                      key={card.id}
                      card={card}
                      selected={checked.has(card.id)}
                      focused={focused?.id === card.id}
                      checked={checked.has(card.id)}
                      onFocus={() =>
                        setFocusIndex(
                          Math.max(
                            0,
                            focusable.findIndex((c) => c.id === card.id),
                          ),
                        )
                      }
                      onToggleCheck={() => toggleCheck(card.id)}
                      onApprove={() => void decide(card, "approve")}
                      onHold={() => setHoldTarget(card)}
                      onReject={() => void decide(card, "reject")}
                      actionsDisabled={guidedMode}
                      guidedFocus={guidedCardId === card.id}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {holdTarget ? (
        <HoldDialog
          card={holdTarget}
          onCancel={() => setHoldTarget(null)}
          onConfirm={(note) => {
            const target = holdTarget;
            setHoldTarget(null);
            void decide(target, "hold", note);
          }}
        />
      ) : null}

      {executeOpen && scanId ? (
        <ExecutePanel
          scanId={scanId}
          cards={approved}
          onClose={() => setExecuteOpen(false)}
          onFinished={() => {
            /* parent may refresh */
          }}
        />
      ) : null}
    </section>
  );
}

function SectionHeading({
  title,
  subtitle,
  count,
  tone,
}: {
  title: string;
  subtitle: string;
  count: number;
  tone?: "warn" | "agent";
}) {
  return (
    <div className="flex items-end justify-between gap-4 border-b border-[var(--color-line)] pb-2">
      <div>
        <h3
          className={`text-[13px] font-semibold tracking-tight ${
            tone === "warn" ? "text-[var(--color-irrev)]" : "text-[var(--color-ink)]"
          } ${tone === "agent" ? "text-[var(--color-hold)]" : ""}`}
        >
          {title}
        </h3>
        <p className="mt-0.5 max-w-xl text-[12px] text-[var(--color-mute)]">{subtitle}</p>
      </div>
      <span className="font-mono text-[12px] text-[var(--color-faint)]">{count}</span>
    </div>
  );
}

function EmptyState({ scanStatus }: { scanStatus: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-start py-16">
      <h3 className="text-[15px] font-semibold tracking-tight">No cards yet</h3>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-mute)]">
        {scanStatus === "running"
          ? "Subagents are still inventorying systems. Cards appear here as reconciliation finishes."
          : scanStatus === "idle"
            ? "Start a scan from the left. Unattributed findings will pin to the top of this queue."
            : "This scan produced no approval cards for the selected person."}
      </p>
    </div>
  );
}
