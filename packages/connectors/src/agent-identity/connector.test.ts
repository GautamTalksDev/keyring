import { describe, expect, it } from "vitest";

import {
  createAgentIdentityConnector,
  createFixtureAgentIdentitySource,
  type AgentIdentityRecord,
} from "./connector.js";

const record: AgentIdentityRecord = {
  id: "agent-grant-test",
  agentId: "test-agent",
  agentName: "Test Agent",
  runtime: "fixture-runtime",
  declaredPurpose: "Run a test inventory",
  reachableTools: ["test-mcp"],
  registeredBy: "owner@keyring-test.example",
  declarationStatus: "declared",
  identityType: "oauth_grant",
  credentialId: "fixture-test-oauth",
  system: "agent_identity",
  resource: {
    id: "oauth/test-agent",
    displayName: "Test agent OAuth grant",
    kind: "oauth_grant",
  },
  capability: "read",
  discoveredAt: "2026-08-29T12:00:00.000Z",
  evidence: [
    {
      claim: "OAuth grant is issued to test-agent",
      source: "fixture:oauth-grants",
      confidence: "certain",
    },
  ],
};

describe("AgentIdentityConnector", () => {
  it("returns evidence-backed agent principals from a fixture source", async () => {
    const connector = createAgentIdentityConnector({
      source: createFixtureAgentIdentitySource([record]),
    });
    const grants = [];
    for await (const grant of connector.inventory({
      credentials: { kind: "read", token: "fixture-read" },
    })) {
      grants.push(grant);
    }

    expect(grants).toHaveLength(1);
    expect(grants[0]?.principal).toMatchObject({
      kind: "ai_agent",
      agentName: "Test Agent",
      runtime: "fixture-runtime",
      declarationStatus: "declared",
      reachableTools: ["test-mcp"],
    });
    expect(grants[0]?.evidence[0]?.source).toBe("fixture:oauth-grants");
  });

  it("includes self-inventory records and refuses mutation", async () => {
    const connector = createAgentIdentityConnector({
      source: createFixtureAgentIdentitySource([]),
      selfInventory: [record],
    });
    const grants = [];
    for await (const grant of connector.inventory({
      credentials: { kind: "read", token: "fixture-read" },
    })) {
      grants.push(grant);
    }

    expect(grants).toHaveLength(1);
    expect(connector.capabilities().canRevoke).toBe(false);
    expect(
      await connector.revoke(grants[0]!, {
        credentials: { kind: "write", token: "fixture-write" },
        approvedBy: "owner@keyring-test.example",
        approvalCardId: "card-test",
      }),
    ).toMatchObject({ ok: false });
  });
});
