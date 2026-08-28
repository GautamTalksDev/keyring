import type { Grant, NonEmptyEvidence } from "@keyring/core";
import {
  createFixtureConnector,
  createFixtureMcpToolCaller,
  createGitHubConnector,
  createGoogleWorkspaceConnector,
  createRemoteMcpToolCaller,
  type Connector,
  type McpToolCaller,
  type RevokeContext,
  type RevokeResult,
  type UndoHint,
  type WriteCredentials,
} from "@keyring/connectors";

/**
 * KEYRING_EXECUTE_DRY_RUN defaults ON ("1"). Set to "0"/"false" to allow live mutations.
 */
export function resolveExecuteDryRun(explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  const env = (process.env.KEYRING_EXECUTE_DRY_RUN ?? "1").toLowerCase();
  return env !== "0" && env !== "false" && env !== "off" && env !== "no";
}

/**
 * KEYRING_REVOKE_BACKEND: fixture (default) | live
 * Live uses GitHub/Google connectors + MCP URLs from env.
 */
export function resolveRevokeBackend(): "fixture" | "live" {
  const env = (process.env.KEYRING_REVOKE_BACKEND ?? "fixture").toLowerCase();
  return env === "live" ? "live" : "fixture";
}

export function createWriteMcpCaller(): McpToolCaller {
  if (resolveRevokeBackend() !== "live") {
    return createFixtureMcpToolCaller();
  }

  const servers: Record<
    string,
    { url: string; headers?: Record<string, string> }
  > = {};

  const githubUrl = process.env.GITHUB_MCP_URL;
  if (githubUrl) {
    const headers: Record<string, string> = {};
    const token = process.env.GITHUB_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    servers.github = { url: githubUrl, headers };
  }

  const googleUrl = process.env.GOOGLE_WORKSPACE_MCP_URL;
  if (googleUrl) {
    const headers: Record<string, string> = {};
    const token = process.env.GOOGLE_ACCESS_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    servers.google_workspace = { url: googleUrl, headers };
  }

  if (Object.keys(servers).length === 0) {
    return createFixtureMcpToolCaller();
  }
  return createRemoteMcpToolCaller({ servers });
}

export function connectorForGrant(grant: Grant): Connector {
  const backend = resolveRevokeBackend();
  if (backend === "live") {
    if (grant.system === "github") {
      const org =
        process.env.GITHUB_ORG ??
        process.env.KEYRING_TEST_ORG_NAME ??
        "keyring-test";
      return createGitHubConnector({ org });
    }
    if (grant.system === "google_workspace") {
      const orgDomain =
        process.env.GOOGLE_ORG_DOMAIN ?? "keyring-test.example";
      return createGoogleWorkspaceConnector({ orgDomain });
    }
  }
  return createFixtureConnector();
}

export function writeCredentialsForGrant(grant: Grant): WriteCredentials {
  if (resolveRevokeBackend() === "live") {
    if (grant.system === "github") {
      return {
        kind: "write",
        token: process.env.GITHUB_TOKEN ?? process.env.KEYRING_FIXTURE_WRITE_TOKEN ?? "missing-github-token",
      };
    }
    if (grant.system === "google_workspace") {
      return {
        kind: "write",
        token:
          process.env.GOOGLE_ACCESS_TOKEN ??
          process.env.KEYRING_FIXTURE_WRITE_TOKEN ??
          "missing-google-token",
      };
    }
  }
  return {
    kind: "write",
    token: process.env.KEYRING_FIXTURE_WRITE_TOKEN ?? "fixture-write",
  };
}

export async function revokeGrant(opts: {
  grant: Grant;
  approvedBy: string;
  approvalCardId: string;
  dryRun: boolean;
  mcp?: McpToolCaller;
  signal?: AbortSignal;
}): Promise<RevokeResult> {
  const connector = connectorForGrant(opts.grant);
  const mcp = opts.mcp ?? createWriteMcpCaller();
  const ctx: RevokeContext = {
    credentials: writeCredentialsForGrant(opts.grant),
    approvedBy: opts.approvedBy,
    approvalCardId: opts.approvalCardId,
    mcp,
    dryRun: opts.dryRun,
    ...(opts.signal ? { signal: opts.signal } : {}),
  };
  return connector.revoke(opts.grant, ctx);
}

/** Append undo-hint evidence so the ledger carries restore instructions. */
export function evidenceWithUndo(
  base: NonEmptyEvidence,
  undoHint: UndoHint | undefined,
  detail?: string,
): NonEmptyEvidence {
  if (!undoHint && !detail) return base;
  const extra = [];
  if (detail) {
    extra.push({
      claim: detail,
      source: "keyring:execute",
      confidence: "certain" as const,
    });
  }
  if (undoHint) {
    extra.push({
      claim: `UNDO HINT restorable=${undoHint.restorable} permission=${undoHint.permission} via ${undoHint.restoreMethod}`,
      source: "keyring:undo_hint",
      confidence: "certain" as const,
      raw: undoHint,
    });
  }
  return [...base, ...extra] as NonEmptyEvidence;
}
