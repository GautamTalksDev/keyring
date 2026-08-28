import type { PersonId } from "./brand.js";
import type { Identifier } from "./identifier.js";

/**
 * A resolved person in Keyring's identity graph (product concern).
 * Distinct from a Grant principal, which may still be unresolved.
 */
export interface Person {
  id: PersonId;
  displayName: string;
  identifiers: Identifier[];
}

/**
 * Normalize an email-shaped identifier value for matching.
 * Pure helper — no I/O.
 */
export function normalizeEmailValue(email: string): string {
  return email.trim().toLowerCase();
}
