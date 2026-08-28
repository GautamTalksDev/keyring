/**
 * Branded nominal types — prevent accidental mixing of string IDs.
 * Pure types only; no I/O.
 */

declare const __brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type GrantId = Brand<string, "GrantId">;
export type PersonId = Brand<string, "PersonId">;
export type ApprovalCardId = Brand<string, "ApprovalCardId">;
export type AuditRecordId = Brand<string, "AuditRecordId">;
export type SystemId = Brand<string, "SystemId">;
export type ResourceId = Brand<string, "ResourceId">;
export type PrincipalId = Brand<string, "PrincipalId">;
export type HashHex = Brand<string, "HashHex">;

export function brand<B extends string>(value: string): Brand<string, B> {
  return value as Brand<string, B>;
}

export function asGrantId(value: string): GrantId {
  return brand<"GrantId">(value);
}

export function asPersonId(value: string): PersonId {
  return brand<"PersonId">(value);
}

export function asApprovalCardId(value: string): ApprovalCardId {
  return brand<"ApprovalCardId">(value);
}

export function asAuditRecordId(value: string): AuditRecordId {
  return brand<"AuditRecordId">(value);
}

export function asSystemId(value: string): SystemId {
  return brand<"SystemId">(value);
}

export function asResourceId(value: string): ResourceId {
  return brand<"ResourceId">(value);
}

export function asPrincipalId(value: string): PrincipalId {
  return brand<"PrincipalId">(value);
}

export function asHashHex(value: string): HashHex {
  return brand<"HashHex">(value);
}
