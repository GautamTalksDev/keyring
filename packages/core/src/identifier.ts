/**
 * How we refer to a principal across systems.
 * `source` is the connector / system that observed this identifier.
 */
export type IdentifierKind =
  | "work_email"
  | "personal_email"
  | "commit_email"
  | "username"
  | "key_id"
  | "display_name";

export interface Identifier {
  kind: IdentifierKind;
  value: string;
  source: string;
}

export function normalizeIdentifier(identifier: Identifier): Identifier {
  return {
    kind: identifier.kind,
    value: identifier.value.trim(),
    source: identifier.source.trim(),
  };
}

/**
 * Canonical sort key so principal hashing is order-independent.
 */
export function identifierSortKey(identifier: Identifier): string {
  const n = normalizeIdentifier(identifier);
  return `${n.kind}\0${n.value.toLowerCase()}\0${n.source}`;
}
