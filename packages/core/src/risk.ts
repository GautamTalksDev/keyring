import type { Grant } from "./grant.js";
import type { PolicyStalenessThresholds } from "./policy/types.js";
import { DEFAULT_STALENESS } from "./policy/types.js";

/**
 * Computed risk — never stored on Grant. Score plus human-readable reasons.
 */
export interface RiskScore {
  /** 0 (lowest) … 100 (highest). */
  score: number;
  reasons: readonly string[];
}

const CAPABILITY_WEIGHT: Record<Grant["capability"], number> = {
  read: 10,
  write: 30,
  admin: 55,
  owner: 70,
};

const MS_PER_DAY = 86_400_000;

export interface RiskScoreOptions {
  /** Reference time for staleness; defaults to now. Inject in tests. */
  now?: Date;
  /** Per-system thresholds from keyring.yml (falls back to defaults). */
  staleness?: PolicyStalenessThresholds;
}

/**
 * Risk from staleness, capability, reversibility, and principal resolution.
 */
export function computeRiskScore(
  grant: Grant,
  options: RiskScoreOptions = {},
): RiskScore {
  const now = options.now ?? new Date();
  const thresholds = options.staleness ?? DEFAULT_STALENESS;
  const reasons: string[] = [];
  let score = 0;

  // Capability
  const cap = CAPABILITY_WEIGHT[grant.capability];
  score += cap;
  reasons.push(`capability ${grant.capability} (+${cap})`);

  // Staleness / lastUsedAt
  if (grant.lastUsedAt === undefined) {
    score += 20;
    reasons.push("lastUsedAt unknown — cannot confirm recent use (+20)");
  } else {
    const days = Math.max(
      0,
      Math.floor((now.getTime() - grant.lastUsedAt.getTime()) / MS_PER_DAY),
    );
    if (days >= thresholds.critical_days) {
      score += 30;
      reasons.push(
        `last used ${days} days ago — highly stale (≥${thresholds.critical_days}d) (+30)`,
      );
    } else if (days >= thresholds.stale_days) {
      score += 20;
      reasons.push(
        `last used ${days} days ago — stale (≥${thresholds.stale_days}d) (+20)`,
      );
    } else if (days >= thresholds.cooling_days) {
      score += 10;
      reasons.push(
        `last used ${days} days ago — cooling (≥${thresholds.cooling_days}d) (+10)`,
      );
    } else {
      reasons.push(`last used ${days} days ago — recent (+0)`);
    }
  }

  // Reversibility / revocability
  if (!grant.revocable.possible) {
    score += 25;
    reasons.push("revocation not possible (+25)");
  } else if (!grant.revocable.reversible) {
    score += 15;
    reasons.push("revocation is irreversible (+15)");
  } else {
    reasons.push(`revocation possible via ${grant.revocable.method} (+0)`);
  }

  // Principal resolution
  if (grant.principal.kind === "unknown") {
    score += 25;
    reasons.push("principal unresolved (kind=unknown) (+25)");
  } else if (grant.principal.identifiers.length === 0) {
    score += 15;
    reasons.push("principal has no identifiers (+15)");
  } else {
    reasons.push(`principal resolved as ${grant.principal.kind} (+0)`);
  }

  return {
    score: Math.min(100, score),
    reasons,
  };
}
