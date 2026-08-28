import type { Confidence } from "../evidence.js";
import type { Grant } from "../grant.js";
import type { Identifier } from "../identifier.js";
import type { GrantId, PersonId } from "../brand.js";

/**
 * A known person from the org directory / IdP / HR system.
 * Directory fields are the ground truth we join grants against.
 */
export interface DirectoryEntry {
  displayName: string;
  workEmails: string[];
  /** Personal emails recorded on the directory record (signal 3). */
  personalEmails?: string[];
  /** Known handles (GitHub, Slack, …) stored on the directory record. */
  usernames?: string[];
  /** ISO timestamp of onboarding — used for temporal correlation (signal 6). */
  onboardedAt?: string;
}

/** Optional explicit attribution of a key/token to a principal (signal 5). */
export interface KeyAttribution {
  keyId: string;
  /** Work email, username, display name, or service-account id. */
  attributedTo: string;
  source: string;
}

/**
 * Declared service account from keyring.yml — seeded as a first-class cluster
 * so CI / automation keys stop landing in `unknown`.
 */
export interface ServiceAccountDeclaration {
  id: string;
  displayName: string;
  owner: string;
  keyIds?: string[];
  resourceIds?: string[];
}

export interface ReconciliationInput {
  grants: Grant[];
  directory?: DirectoryEntry[];
  keyAttributions?: KeyAttribution[];
  serviceAccounts?: ServiceAccountDeclaration[];
  /**
   * Days around onboardedAt for temporal correlation (signal 6).
   * Default: 14.
   */
  onboardingWindowDays?: number;
}

export type ClusterKind = "human" | "service_account";

/**
 * One resolved identity — a person or named service account — with the
 * grants we attributed to them and a plain-English inference chain.
 */
export interface IdentityCluster {
  id: string;
  kind: ClusterKind;
  displayName: string;
  personId?: PersonId;
  identifiers: Identifier[];
  grantIds: GrantId[];
  /** Weakest link in the chain that attached any grant to this cluster. */
  confidence: Confidence;
  reasoning: string;
}

/**
 * Grants we refuse to force into a person. An honest unknown count is a feature.
 */
export interface UnknownBucket {
  grantIds: GrantId[];
  reasoning: string;
}

export interface ReconciliationResult {
  clusters: IdentityCluster[];
  unknown: UnknownBucket;
}

/** Signal kinds, descending trust — used in reasoning strings. */
export type SignalKind =
  | "work_email_exact"
  | "commit_email_matches_work"
  | "personal_email_in_directory"
  | "username_in_directory"
  | "username_similarity"
  | "key_attribution"
  | "temporal_onboarding";
