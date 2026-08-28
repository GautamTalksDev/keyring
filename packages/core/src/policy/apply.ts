import type { Grant } from "../grant.js";
import type { KeyAttribution } from "../identity/types.js";
import type {
  AutoApproveRule,
  KeyringPolicy,
  PolicyStalenessThresholds,
  ProtectedResourceRule,
  ServiceAccountPolicy,
} from "./types.js";
import { DEFAULT_STALENESS, EMPTY_POLICY } from "./types.js";

/** Glob match: `*` = one segment, `**` = any depth. */
export function matchResourcePattern(pattern: string, resourceId: string): boolean {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§§")
    .replace(/\*/g, "[^/]*")
    .replace(/§§/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(resourceId);
}

export function resolveStaleness(
  policy: KeyringPolicy | null | undefined,
  system: string,
): PolicyStalenessThresholds {
  const defaults = policy?.staleness?.defaults ?? DEFAULT_STALENESS;
  const override = policy?.staleness?.systems?.[system] ?? {};
  return {
    cooling_days: override.cooling_days ?? defaults.cooling_days,
    stale_days: override.stale_days ?? defaults.stale_days,
    critical_days: override.critical_days ?? defaults.critical_days,
  };
}

export function findProtectedRule(
  grant: Grant,
  policy: KeyringPolicy | null | undefined,
): ProtectedResourceRule | undefined {
  if (!policy) return undefined;
  for (const rule of policy.protected) {
    if (rule.system && rule.system !== grant.system) continue;
    if (matchResourcePattern(rule.resource, grant.resource.id)) return rule;
  }
  return undefined;
}

export function findAutoApproveRule(
  grant: Grant,
  riskScore: number,
  policy: KeyringPolicy | null | undefined,
): AutoApproveRule | undefined {
  if (!policy?.auto_approve?.enabled) return undefined;
  if (findProtectedRule(grant, policy)) return undefined;

  for (const rule of policy.auto_approve.rules) {
    const maxCap = rule.max_capability ?? "read";
    const capRank = { read: 0, write: 1, admin: 2, owner: 3 } as const;
    if (capRank[grant.capability] > capRank[maxCap]) continue;
    if ((rule.reversible_only ?? true) && !grant.revocable.reversible) continue;
    if (!grant.revocable.possible) continue;
    if (rule.systems && !rule.systems.includes(grant.system)) continue;
    if (riskScore > (rule.max_risk ?? 40)) continue;
    return rule;
  }
  return undefined;
}

/** Turn service_accounts into key attributions for the reconciler. */
export function keyAttributionsFromPolicy(
  policy: KeyringPolicy | null | undefined,
): KeyAttribution[] {
  if (!policy) return [];
  const out: KeyAttribution[] = [];
  for (const sa of policy.service_accounts) {
    for (const keyId of sa.key_ids ?? []) {
      out.push({
        keyId,
        attributedTo: sa.id,
        source: `keyring.yml:service_accounts/${sa.id}`,
      });
    }
  }
  return out;
}

export function serviceAccountsFromPolicy(
  policy: KeyringPolicy | null | undefined,
): ServiceAccountPolicy[] {
  return policy?.service_accounts ?? [];
}

/**
 * Normalize a loose object (parsed YAML) into KeyringPolicy with defaults.
 */
export function normalizePolicy(raw: unknown): KeyringPolicy {
  if (raw === null || typeof raw !== "object") return { ...EMPTY_POLICY };
  const o = raw as Record<string, unknown>;
  const stalenessRaw =
    o.staleness && typeof o.staleness === "object"
      ? (o.staleness as Record<string, unknown>)
      : {};
  const defaultsRaw =
    stalenessRaw.defaults && typeof stalenessRaw.defaults === "object"
      ? (stalenessRaw.defaults as Record<string, unknown>)
      : {};
  const autoRaw =
    o.auto_approve && typeof o.auto_approve === "object"
      ? (o.auto_approve as Record<string, unknown>)
      : {};
  const reauditRaw =
    o.reaudit && typeof o.reaudit === "object"
      ? (o.reaudit as Record<string, unknown>)
      : undefined;

  return {
    version: typeof o.version === "number" ? o.version : 1,
    protected: Array.isArray(o.protected)
      ? (o.protected as ProtectedResourceRule[])
      : [],
    service_accounts: Array.isArray(o.service_accounts)
      ? (o.service_accounts as ServiceAccountPolicy[])
      : [],
    staleness: {
      defaults: {
        cooling_days:
          typeof defaultsRaw.cooling_days === "number"
            ? defaultsRaw.cooling_days
            : DEFAULT_STALENESS.cooling_days,
        stale_days:
          typeof defaultsRaw.stale_days === "number"
            ? defaultsRaw.stale_days
            : DEFAULT_STALENESS.stale_days,
        critical_days:
          typeof defaultsRaw.critical_days === "number"
            ? defaultsRaw.critical_days
            : DEFAULT_STALENESS.critical_days,
      },
      systems:
        stalenessRaw.systems && typeof stalenessRaw.systems === "object"
          ? (stalenessRaw.systems as KeyringPolicy["staleness"]["systems"])
          : undefined,
    },
    auto_approve: {
      enabled: autoRaw.enabled === true,
      rules: Array.isArray(autoRaw.rules)
        ? (autoRaw.rules as AutoApproveRule[])
        : [],
    },
    ...(reauditRaw
      ? {
          reaudit: {
            ...(typeof reauditRaw.cron === "string"
              ? { cron: reauditRaw.cron }
              : {}),
            ...(typeof reauditRaw.diff_only === "boolean"
              ? { diff_only: reauditRaw.diff_only }
              : {}),
          },
        }
      : {}),
  };
}
