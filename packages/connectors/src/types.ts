import type { Grant } from "@keyring/core";

import type { McpToolCaller } from "./mcp/types.js";

/**
 * Read-scoped credentials. Inventory may only ever receive this shape —
 * write tokens cannot be passed without a type error.
 */
export interface ReadCredentials {
  readonly kind: "read";
  /** Opaque read token / API key for inventory APIs. */
  readonly token: string;
}

/**
 * Write-scoped credentials. Only present on revoke context, after human approval.
 */
export interface WriteCredentials {
  readonly kind: "write";
  /** Opaque write token with mutation scope. */
  readonly token: string;
}

/**
 * Context for read-only inventory. No write credentials by construction.
 *
 * Live connectors require {@link mcp} — a TrueForge-backed (or test) MCP tool
 * caller. FixtureConnector does not need it.
 */
export interface InventoryContext {
  readonly credentials: ReadCredentials;
  readonly mcp?: McpToolCaller;
  readonly signal?: AbortSignal;
}

/**
 * Context for mutating revoke. Carries write-scoped credentials only.
 * Must never be used for inventory.
 */
export interface RevokeContext {
  readonly credentials: WriteCredentials;
  readonly approvedBy: string;
  readonly approvalCardId: string;
  readonly mcp?: McpToolCaller;
  readonly signal?: AbortSignal;
  /**
   * When true, walk the revoke path and report undo hints without calling
   * any mutating MCP/API. Defaulted by the product execute layer.
   */
  readonly dryRun?: boolean;
}

export interface ConnectorCapabilities {
  canRevoke: boolean;
  canDowngrade: boolean;
  reportsLastUsed: boolean;
}

/**
 * Exact permission removed, enough to restore a mistaken revoke when the
 * system supports it. Absent on permanent revokes (PATs, deploy keys, …).
 */
export interface UndoHint {
  restorable: true;
  system: string;
  /** Human-readable permission that was removed (e.g. `push`, `writer`, `MEMBER`). */
  permission: string;
  /** MCP / API method that would restore access. */
  restoreMethod: string;
  /** Arguments for restoreMethod. */
  params: Record<string, unknown>;
}

export type RevokeResult =
  | {
      ok: true;
      detail?: string;
      undoHint?: UndoHint;
      /** Grant was already gone — treated as success for idempotent retry. */
      alreadyAbsent?: boolean;
    }
  | { ok: false; error: string };

/**
 * Every source system implements this interface.
 *
 * Hard rule: `inventory` takes {@link InventoryContext} (read credentials only).
 * `revoke` takes {@link RevokeContext} (write credentials only). Types make
 * speculative mutation via inventory a compile-time impossibility.
 */
export interface Connector {
  readonly id: string;
  readonly displayName: string;

  /** Read-only. Always safe to call. */
  inventory(ctx: InventoryContext): AsyncIterable<Grant>;

  /** Mutating. Called ONLY after human approval, never speculatively. */
  revoke(grant: Grant, ctx: RevokeContext): Promise<RevokeResult>;

  /** Declares what this connector can and cannot do. */
  capabilities(): ConnectorCapabilities;
}
