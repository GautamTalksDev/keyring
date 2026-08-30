import {
  asGrantId,
  asPrincipalId,
  asResourceId,
  asSystemId,
  type GrantId,
  type PrincipalId,
  type ResourceId,
  type SystemId,
} from "./brand.js";
import { requireNonEmptyEvidence, type Evidence, type NonEmptyEvidence } from "./evidence.js";
import { sha256Hex } from "./hash.js";
import { identifierSortKey, normalizeIdentifier, type Identifier } from "./identifier.js";

export type System =
  "google_workspace" | "github" | "slack" | "aws" | "notion" | "agent_identity" | "custom";

export type PrincipalKind = "human" | "service_account" | "ai_agent" | "unknown";

export type Principal =
  | { kind: "human"; identifiers: Identifier[] }
  | { kind: "service_account"; identifiers: Identifier[] }
  | {
      kind: "ai_agent";
      identifiers: Identifier[];
      agentName: string;
      runtime: string;
      declaredPurpose?: string;
      reachableTools: string[];
      registeredBy?: string;
      declarationStatus: "declared" | "unregistered";
    }
  | { kind: "unknown"; identifiers: Identifier[] };

export type ResourceKind =
  | "repo"
  | "drive_folder"
  | "iam_role"
  | "channel"
  | "database"
  | "bucket"
  | "page"
  | "mcp_server"
  | "github_app"
  | "agent_registration"
  | "oauth_grant"
  | "other";

export interface Resource {
  id: ResourceId;
  displayName: string;
  kind: ResourceKind;
}

export type Capability = "read" | "write" | "admin" | "owner";

export type GrantAccessState = "active" | "pending_invitation";

export interface Revocable {
  possible: boolean;
  reversible: boolean;
  method: string;
}

/**
 * A single unit of access that some identity holds on some system.
 */
export interface Grant {
  /** Deterministic hash of (systemId + resourceId + principalId). */
  id: GrantId;
  system: System;
  principal: Principal;
  resource: Resource;
  capability: Capability;
  /** Whether access is active or awaiting acceptance of an invitation. */
  accessState?: GrantAccessState;
  createdAt?: Date;
  lastUsedAt?: Date;
  discoveredAt: Date;
  revocable: Revocable;
  /** How we know this grant exists and how we attributed it — never empty. */
  evidence: NonEmptyEvidence;
}

export interface GrantIdParts {
  systemId: SystemId | System;
  resourceId: ResourceId | string;
  principalId: PrincipalId | string;
}

/**
 * Stable principal fingerprint from kind + sorted identifiers.
 * Empty identifier lists still produce a stable id (kind alone).
 */
export function computePrincipalId(principal: Principal): PrincipalId {
  const normalized = principal.identifiers.map(normalizeIdentifier);
  const sorted = [...normalized].sort((a, b) =>
    identifierSortKey(a).localeCompare(identifierSortKey(b)),
  );
  const payload = [
    principal.kind,
    ...sorted.map((id) => `${id.kind}:${id.value.toLowerCase()}:${id.source}`),
  ].join("\0");
  return asPrincipalId(sha256Hex(payload));
}

/**
 * Stable, deterministic grant id so re-scans dedupe.
 * Hash of (systemId + resourceId + principalId).
 */
export function computeGrantId(parts: GrantIdParts): GrantId {
  const systemId = String(parts.systemId);
  const resourceId = String(parts.resourceId);
  const principalId = String(parts.principalId);
  return asGrantId(sha256Hex(`${systemId}\0${resourceId}\0${principalId}`));
}

export function grantIdFor(input: {
  system: System;
  resource: Pick<Resource, "id">;
  principal: Principal;
}): GrantId {
  return computeGrantId({
    systemId: asSystemId(input.system),
    resourceId: input.resource.id,
    principalId: computePrincipalId(input.principal),
  });
}

export interface CreateGrantInput {
  system: System;
  principal: Principal;
  resource: Omit<Resource, "id"> & { id: string };
  capability: Capability;
  accessState?: GrantAccessState;
  createdAt?: Date;
  lastUsedAt?: Date;
  discoveredAt: Date;
  revocable: Revocable;
  evidence: readonly Evidence[];
}

/**
 * Construct a Grant with mandatory non-empty evidence and a deterministic id.
 */
export function createGrant(input: CreateGrantInput): Grant {
  const evidence = requireNonEmptyEvidence(input.evidence);
  const resource: Resource = {
    id: asResourceId(input.resource.id),
    displayName: input.resource.displayName,
    kind: input.resource.kind,
  };
  const principal: Principal =
    input.principal.kind === "ai_agent"
      ? {
          ...input.principal,
          identifiers: input.principal.identifiers.map(normalizeIdentifier),
          reachableTools: [...input.principal.reachableTools],
        }
      : {
          kind: input.principal.kind,
          identifiers: input.principal.identifiers.map(normalizeIdentifier),
        };
  return {
    id: grantIdFor({ system: input.system, resource, principal }),
    system: input.system,
    principal,
    resource,
    capability: input.capability,
    ...(input.accessState !== undefined ? { accessState: input.accessState } : {}),
    ...(input.createdAt !== undefined ? { createdAt: input.createdAt } : {}),
    ...(input.lastUsedAt !== undefined ? { lastUsedAt: input.lastUsedAt } : {}),
    discoveredAt: input.discoveredAt,
    revocable: input.revocable,
    evidence,
  };
}
