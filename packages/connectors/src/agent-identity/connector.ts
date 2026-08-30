import { createGrant, type Grant, type ResourceKind } from "@keyring/core";

import type { McpToolCaller } from "../mcp/types.js";
import type {
  Connector,
  ConnectorCapabilities,
  InventoryContext,
  RevokeContext,
  RevokeResult,
} from "../types.js";

export interface AgentIdentityRecord {
  id: string;
  agentId: string;
  agentName: string;
  runtime: string;
  declaredPurpose?: string;
  reachableTools: string[];
  registeredBy?: string;
  declarationStatus: "declared" | "unregistered";
  identityType: "mcp_token" | "service_account" | "github_app" | "oauth_grant";
  credentialId: string;
  system: Grant["system"];
  resource: {
    id: string;
    displayName: string;
    kind: ResourceKind;
  };
  capability: Grant["capability"];
  discoveredAt: string | Date;
  lastUsedAt?: string | Date;
  evidence: Array<{
    claim: string;
    source: string;
    confidence: "certain" | "probable" | "speculative";
    observedAt?: string;
    locator?: string;
  }>;
}

export interface AgentIdentitySource {
  readonly id: string;
  listAgentIdentities(ctx: InventoryContext): Promise<AgentIdentityRecord[]>;
}

export interface AgentIdentityConnectorOptions {
  source: AgentIdentitySource;
  /** Optional records representing the connector's own access. */
  selfInventory?: AgentIdentityRecord[];
}

/**
 * Connector contract for agent-held identities.
 *
 * The source is deliberately injected. This supports fixture and MCP-backed
 * inventories without pretending Keyring can read provider APIs it does not
 * have access to. A live adapter can implement AgentIdentitySource when a
 * customer supplies a readable source.
 */
export function createAgentIdentityConnector(options: AgentIdentityConnectorOptions): Connector {
  return {
    id: "agent-identity",
    displayName: "Agent identities",

    async *inventory(ctx: InventoryContext): AsyncIterable<Grant> {
      if (ctx.credentials.kind !== "read") {
        throw new Error("inventory requires ReadCredentials (kind: 'read')");
      }
      const records = [
        ...(await options.source.listAgentIdentities(ctx)),
        ...(options.selfInventory ?? []),
      ];
      for (const record of records) {
        ctx.signal?.throwIfAborted();
        yield recordToGrant(record);
      }
    },

    async revoke(_grant: Grant, _ctx: RevokeContext): Promise<RevokeResult> {
      return {
        ok: false,
        error:
          "Agent identity connector is inventory-only. Revoke the underlying credential through its source connector.",
      };
    },

    capabilities(): ConnectorCapabilities {
      return {
        canRevoke: false,
        canDowngrade: false,
        reportsLastUsed: true,
      };
    },
  };
}

export function createFixtureAgentIdentitySource(
  records: AgentIdentityRecord[],
): AgentIdentitySource {
  return {
    id: "fixture-agent-identities",
    async listAgentIdentities(ctx) {
      void ctx.credentials;
      return records.map((record) => ({
        ...record,
        reachableTools: [...record.reachableTools],
        evidence: record.evidence.map((evidence) => ({ ...evidence })),
      }));
    },
  };
}

export function createMcpAgentIdentitySource(options: {
  mcp: McpToolCaller;
  server?: string;
  tool?: string;
}): AgentIdentitySource {
  const server = options.server ?? "trueforge";
  const tool = options.tool ?? "list_agent_identities";
  return {
    id: `mcp:${server}/${tool}`,
    async listAgentIdentities(ctx) {
      const result = await options.mcp.callTool({
        server,
        tool,
        signal: ctx.signal,
      });
      if (!Array.isArray(result.data)) {
        throw new Error(`MCP ${server}/${tool} returned a non-array agent inventory`);
      }
      return result.data as AgentIdentityRecord[];
    },
  };
}

function recordToGrant(record: AgentIdentityRecord): Grant {
  return createGrant({
    system: record.system,
    principal: {
      kind: "ai_agent",
      identifiers: [
        { kind: "agent_id", value: record.agentId, source: record.identityType },
        { kind: "key_id", value: record.credentialId, source: record.identityType },
      ],
      agentName: record.agentName,
      runtime: record.runtime,
      ...(record.declaredPurpose ? { declaredPurpose: record.declaredPurpose } : {}),
      reachableTools: [...record.reachableTools],
      ...(record.registeredBy ? { registeredBy: record.registeredBy } : {}),
      declarationStatus: record.declarationStatus,
    },
    resource: record.resource,
    capability: record.capability,
    discoveredAt: new Date(record.discoveredAt),
    ...(record.lastUsedAt ? { lastUsedAt: new Date(record.lastUsedAt) } : {}),
    revocable: {
      possible: false,
      reversible: false,
      method: "source_connector_required",
    },
    evidence: record.evidence,
  });
}
