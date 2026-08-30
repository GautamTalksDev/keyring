import { asApprovalCardId, type PersonId } from "./brand.js";
import { sha256Hex } from "./hash.js";
import type { Grant } from "./grant.js";
import { computeRiskScore } from "./risk.js";
import type { ReconciliationResult } from "./identity/types.js";
import { CI_TRAP_MARKER } from "./identity/trap.js";
import type { ApprovalCard, Attribution, ProposedAction } from "./approval.js";
import type { KeyringPolicy } from "./policy/types.js";
import { findAutoApproveRule, findProtectedRule, resolveStaleness } from "./policy/apply.js";

export interface BuildApprovalCardsInput {
  grants: Grant[];
  reconciliation: ReconciliationResult;
  /** Reference time for risk staleness. */
  now?: Date;
  /** Customer policy from keyring.yml. */
  policy?: KeyringPolicy | null;
}

/**
 * Build pending ApprovalCards from grants + identity clusters.
 * CI-trap / do-not-revoke evidence → flag_only + held (not revoke).
 * Policy: protected resources, auto-approve (off by default), per-system staleness.
 */
export function buildApprovalCards(input: BuildApprovalCardsInput): ApprovalCard[] {
  const { grants, reconciliation, now, policy } = input;

  const attributionByGrant = new Map<string, Attribution>();
  const riskAttributionByGrant = new Map<
    string,
    {
      kind: Grant["principal"]["kind"];
      confidence: "certain" | "probable" | "speculative";
    }
  >();
  for (const cluster of reconciliation.clusters) {
    for (const gid of cluster.grantIds) {
      attributionByGrant.set(gid, {
        resolvedTo: cluster.principalId ?? cluster.personId,
        confidence: cluster.confidence,
        reasoning: cluster.reasoning,
      });
      riskAttributionByGrant.set(gid, {
        kind: cluster.kind,
        confidence: cluster.confidence,
      });
    }
  }
  for (const gid of reconciliation.unknown.grantIds) {
    attributionByGrant.set(gid, {
      confidence: "speculative",
      reasoning: reconciliation.unknown.reasoning,
    });
  }

  const cards: ApprovalCard[] = [];
  for (const grant of grants) {
    const attribution = attributionByGrant.get(grant.id) ?? {
      confidence: "speculative" as const,
      reasoning: "No reconciliation attribution available for this grant.",
    };
    const staleness = resolveStaleness(policy, grant.system);
    const risk = computeRiskScore(grant, {
      now,
      staleness,
      attribution: riskAttributionByGrant.get(grant.id),
    });
    const protectedRule = findProtectedRule(grant, policy);
    const proposedAction = proposeAction(grant, attribution, protectedRule?.reason);
    const autoRule =
      proposedAction.kind !== "flag_only"
        ? findAutoApproveRule(grant, risk.score, policy)
        : undefined;

    let status: ApprovalCard["status"] =
      proposedAction.kind === "flag_only" && isCiTrap(grant) ? "held" : "pending";

    // Protected always stays pending (or held for CI trap) — never auto-approved
    if (autoRule && !protectedRule && status === "pending") {
      status = "approved";
    }

    cards.push({
      id: asApprovalCardId(
        sha256Hex(
          `card:${grant.id}:${proposedAction.kind}:${status}:${protectedRule?.resource ?? ""}:${autoRule?.id ?? ""}`,
        ),
      ),
      grant,
      proposedAction,
      irreversible: !grant.revocable.reversible || !grant.revocable.possible,
      risk,
      attribution,
      status,
      ...(protectedRule ? { protected: true, protectedReason: protectedRule.reason } : {}),
      ...(autoRule && status === "approved"
        ? {
            autoApprovedBy: autoRule.id,
            decision: {
              by: `policy:${autoRule.id}`,
              at: now ?? new Date(),
              note: autoRule.description,
            },
          }
        : {}),
    });
  }

  cards.sort((a, b) => b.risk.score - a.risk.score);
  return cards;
}

function isCiTrap(grant: Grant): boolean {
  return grant.evidence.some(
    (e) => e.claim.includes("KEYRING_DO_NOT_REVOKE_CI_INFRA") || e.claim.includes(CI_TRAP_MARKER),
  );
}

function proposeAction(
  grant: Grant,
  attribution: Attribution,
  protectedReason?: string,
): ProposedAction {
  if (grant.principal.kind === "ai_agent" && grant.principal.declarationStatus === "unregistered") {
    return {
      kind: "flag_only",
      description:
        "AI agent is not declared in policy — flag its owner before changing live access.",
    };
  }

  if (grant.system === "agent_identity") {
    return {
      kind: "flag_only",
      description:
        "Agent identity evidence is inventory-only; review the underlying source connector before changing access.",
    };
  }

  if (isCiTrap(grant)) {
    return {
      kind: "flag_only",
      description:
        "Looks orphaned but evidence marks CI infrastructure — HOLD / flag only. Never revoke.",
    };
  }

  if (protectedReason) {
    // Still propose revoke/downgrade but human must approve individually
    if (grant.capability === "admin" || grant.capability === "owner") {
      return {
        kind: "revoke",
        description: `Protected: ${protectedReason}. Revoke ${grant.capability} on ${grant.resource.displayName} requires individual approval.`,
      };
    }
  }

  if (grant.principal.kind === "unknown" && attribution.resolvedTo === undefined) {
    return {
      kind: "flag_only",
      description: "Principal unresolved — flag for human investigation before any revoke.",
    };
  }

  if (grant.capability === "admin" || grant.capability === "owner") {
    if (!grant.revocable.possible) {
      return {
        kind: "flag_only",
        description: "High capability but revocation not possible via connector.",
      };
    }
    return {
      kind: "revoke",
      description: `Revoke ${grant.capability} on ${grant.resource.displayName} (${grant.system}).`,
    };
  }

  if (grant.lastUsedAt === undefined) {
    return {
      kind: "flag_only",
      description: "No last-used signal — flag before revoke.",
    };
  }

  return {
    kind: "downgrade",
    description: `Consider downgrading ${grant.capability} on ${grant.resource.displayName}.`,
  };
}

/** Filter cards that propose revoke for a specific person id. */
export function cardsForPerson(cards: ApprovalCard[], personId: PersonId): ApprovalCard[] {
  return cards.filter((c) => c.attribution.resolvedTo === personId);
}
