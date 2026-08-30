import { createGrant, type CreateGrantInput, type Grant } from "../grant.js";
import { requireNonEmptyEvidence, type Evidence } from "../evidence.js";
import { reconcileIdentities } from "./reconcile.js";
import type {
  DirectoryEntry,
  KeyAttribution,
  ReconciliationInput,
  ReconciliationResult,
  ServiceAccountDeclaration,
} from "./types.js";

export interface ReconciliationJsonInput {
  grants: unknown[];
  directory?: DirectoryEntry[];
  keyAttributions?: KeyAttribution[];
  serviceAccounts?: ServiceAccountDeclaration[];
  onboardingWindowDays?: number;
}

/**
 * Parse a JSON document (sandbox stdin / file) into grants and run reconciliation.
 * Accepts either CreateGrantInput shapes or materialized grants with ISO dates.
 */
export function runReconciliationFromJson(doc: ReconciliationJsonInput): ReconciliationResult {
  const grants = doc.grants.map((raw, index) => reviveGrant(raw, index));
  const input: ReconciliationInput = {
    grants,
    directory: doc.directory,
    keyAttributions: doc.keyAttributions,
    serviceAccounts: doc.serviceAccounts,
    onboardingWindowDays: doc.onboardingWindowDays,
  };
  return reconcileIdentities(input);
}

function reviveGrant(raw: unknown, index: number): Grant {
  if (raw === null || typeof raw !== "object") {
    throw new Error(`grants[${index}] must be an object`);
  }
  const g = raw as Record<string, unknown>;

  if (typeof g.id === "string" && g.principal && g.resource && g.evidence) {
    const evidence = requireNonEmptyEvidence(g.evidence as Evidence[]);
    return {
      id: g.id as Grant["id"],
      system: g.system as Grant["system"],
      principal: g.principal as Grant["principal"],
      resource: g.resource as Grant["resource"],
      capability: g.capability as Grant["capability"],
      ...(g.accessState ? { accessState: g.accessState as Grant["accessState"] } : {}),
      discoveredAt: new Date(String(g.discoveredAt)),
      revocable: g.revocable as Grant["revocable"],
      evidence,
      ...(g.createdAt ? { createdAt: new Date(String(g.createdAt)) } : {}),
      ...(g.lastUsedAt ? { lastUsedAt: new Date(String(g.lastUsedAt)) } : {}),
    };
  }

  return createGrant({
    ...(g as unknown as CreateGrantInput),
    discoveredAt: new Date(String(g.discoveredAt)),
    ...(g.createdAt ? { createdAt: new Date(String(g.createdAt)) } : {}),
    ...(g.lastUsedAt ? { lastUsedAt: new Date(String(g.lastUsedAt)) } : {}),
  });
}
