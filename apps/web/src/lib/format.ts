import type { ApiCard } from "../api/types.js";

const MS_DAY = 86_400_000;

export interface ScanSummaryCounts {
  grants: number;
  systems: number;
  humanIdentities: number;
  agentIdentities: number;
  unattributed: number;
  overYearIdle: number;
  irreversible: number;
}

export function countScanSummary(
  cards: ApiCard[],
  systemIds: Iterable<string> = cards.map((card) => card.grant.system),
  now = new Date(),
): ScanSummaryCounts {
  const humanIdentities = new Set(
    cards
      .filter((card) => card.grant.principal.kind === "human")
      .map((card) => card.attribution.resolvedTo ?? principalLabel(card)),
  ).size;
  const agentIdentities = new Set(
    cards
      .filter((card) => card.grant.principal.kind === "ai_agent")
      .map(
        (card) =>
          card.grant.principal.identifiers.find((identifier) => identifier.kind === "agent_id")
            ?.value ?? principalLabel(card),
      ),
  ).size;
  return {
    grants: cards.length,
    systems: new Set(systemIds).size,
    humanIdentities,
    agentIdentities,
    unattributed: cards.filter(isUnattributed).length,
    overYearIdle: cards.filter((card) => staleness(card.grant.lastUsedAt, now).level === "critical")
      .length,
    irreversible: cards.filter((card) => card.irreversible).length,
  };
}

export function scanSummaryText(counts: ScanSummaryCounts): string {
  const clauses = [
    `${counts.grants} grant${counts.grants === 1 ? "" : "s"} across ${counts.systems} system${counts.systems === 1 ? "" : "s"}.`,
    `${counts.humanIdentities} human identit${counts.humanIdentities === 1 ? "y" : "ies"} and ${counts.agentIdentities} AI agent identit${counts.agentIdentities === 1 ? "y" : "ies"}.`,
    counts.unattributed > 0 ? `${counts.unattributed} we cannot attribute to anyone.` : null,
    counts.overYearIdle > 0 ? `${counts.overYearIdle} not used in over a year.` : null,
    counts.irreversible > 0
      ? `${counts.irreversible} ${counts.irreversible === 1 ? "is" : "are"} irreversible to revoke.`
      : null,
  ].filter((clause): clause is string => clause !== null);
  return clauses.join(" ");
}

export function principalLabel(card: ApiCard): string {
  if (card.grant.principal.kind === "ai_agent" && card.grant.principal.agentName) {
    return card.grant.principal.agentName;
  }
  const ids = card.grant.principal.identifiers;
  if (ids.length === 0) return "Unknown principal";
  const preferred =
    ids.find((i) => i.kind === "work_email") ??
    ids.find((i) => i.kind === "username") ??
    ids.find((i) => i.kind === "display_name") ??
    ids[0]!;
  return preferred.value;
}

export function isUnattributed(card: ApiCard): boolean {
  // Once reconcile/policy sets resolvedTo, the card is attributed —
  // even if the raw grant principal.kind is still "unknown" (CI keys).
  return card.attribution.resolvedTo === undefined;
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function staleness(
  iso: string | null | undefined,
  now = new Date(),
): {
  label: string;
  level: "ok" | "cool" | "stale" | "critical" | "unknown";
  days: number | null;
} {
  if (!iso) {
    return { label: "Never observed", level: "unknown", days: null };
  }
  const days = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / MS_DAY));
  if (days >= 365) {
    return { label: `${days}d idle`, level: "critical", days };
  }
  if (days >= 90) {
    return { label: `${days}d idle`, level: "stale", days };
  }
  if (days >= 30) {
    return { label: `${days}d idle`, level: "cool", days };
  }
  return { label: `${days}d ago`, level: "ok", days };
}

export function systemLabel(system: string): string {
  const map: Record<string, string> = {
    github: "GitHub",
    google_workspace: "Google Workspace",
    slack: "Slack",
    notion: "Notion",
    aws: "AWS",
    agent_identity: "Agent identities",
  };
  return map[system] ?? system;
}

export function confidenceLabel(c: string): string {
  if (c === "certain") return "Certain";
  if (c === "probable") return "Probable";
  return "Speculative";
}

export function actionVerb(kind: ApiCard["proposedAction"]["kind"]): string {
  switch (kind) {
    case "revoke":
      return "Revoke";
    case "downgrade":
      return "Downgrade";
    case "transfer_ownership":
      return "Transfer";
    case "flag_only":
      return "Flag only";
  }
}

export function sortCards(cards: ApiCard[]): ApiCard[] {
  return [...cards].sort((a, b) => {
    const ua = isUnattributed(a) ? 0 : 1;
    const ub = isUnattributed(b) ? 0 : 1;
    if (ua !== ub) return ua - ub;
    return b.risk.score - a.risk.score;
  });
}
