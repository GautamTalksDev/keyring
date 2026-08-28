/**
 * Provenance for every asserted fact.
 * Evidence is never optional and never empty on a Grant — if we cannot say
 * how we know something, we do not assert it.
 */
export type Confidence = "certain" | "probable" | "speculative";

export interface Evidence {
  /** What we claim (e.g. "ACL lists user on Drive folder"). */
  claim: string;
  /** Where the claim came from (connector id, API, log line). */
  source: string;
  confidence: Confidence;
  /** Optional raw payload for audit / debugging; not required for validity. */
  raw?: unknown;
}

/** At least one Evidence item — encoded in the type system. */
export type NonEmptyEvidence = readonly [Evidence, ...Evidence[]];

export function isNonEmptyEvidence(
  evidence: readonly Evidence[],
): evidence is NonEmptyEvidence {
  return evidence.length > 0;
}

export function requireNonEmptyEvidence(
  evidence: readonly Evidence[],
): NonEmptyEvidence {
  if (!isNonEmptyEvidence(evidence)) {
    throw new Error(
      "Evidence is mandatory and must be non-empty: if we cannot say how we know a grant exists, we must not assert it.",
    );
  }
  return evidence;
}
