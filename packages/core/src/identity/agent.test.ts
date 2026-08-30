import { describe, expect, it } from "vitest";

import { createGrant } from "../grant.js";
import { computeRiskScore } from "../risk.js";
import { reconcileIdentities } from "./reconcile.js";

function agentGrant(overrides: Partial<Parameters<typeof createGrant>[0]> = {}) {
  return createGrant({
    system: "agent_identity",
    principal: {
      kind: "ai_agent",
      identifiers: [{ kind: "agent_id", value: "declared-agent", source: "trueforge" }],
      agentName: "Declared Agent",
      runtime: "TrueForge",
      declaredPurpose: "Test purpose",
      reachableTools: ["keyring-mcp"],
      declarationStatus: "declared",
    },
    resource: {
      id: "trueforge/agent/declared-agent",
      displayName: "Declared agent registration",
      kind: "agent_registration",
    },
    capability: "read",
    discoveredAt: new Date("2026-08-29T12:00:00.000Z"),
    revocable: { possible: false, reversible: false, method: "source_required" },
    evidence: [
      {
        claim: "TrueForge registered the agent",
        source: "trueforge",
        confidence: "certain",
      },
    ],
    ...overrides,
  });
}

describe("AI agent identity governance", () => {
  it("matches agents by exact agent identifiers, not human directory signals", () => {
    const result = reconcileIdentities({
      grants: [agentGrant()],
      directory: [
        {
          displayName: "Declared Agent",
          workEmails: ["owner@keyring-test.example"],
        },
      ],
      declaredAgents: [
        {
          id: "declared-agent",
          name: "Declared Agent",
          runtime: "TrueForge",
          owner: "owner@keyring-test.example",
          purpose: "Test purpose",
          agentIds: ["declared-agent"],
        },
      ],
    });

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]).toMatchObject({
      kind: "ai_agent",
      displayName: "Declared Agent",
      agent: { owner: "owner@keyring-test.example" },
    });
    expect(result.unknown.grantIds).toHaveLength(0);
  });

  it("keeps an unregistered agent out of declared clusters", () => {
    const grant = agentGrant({
      principal: {
        kind: "ai_agent",
        identifiers: [{ kind: "agent_id", value: "rogue-agent", source: "trueforge" }],
        agentName: "Rogue Agent",
        runtime: "external",
        reachableTools: ["deploy-mcp"],
        declarationStatus: "unregistered",
      },
    });
    const result = reconcileIdentities({
      grants: [grant],
      declaredAgents: [],
    });
    expect(result.clusters).toHaveLength(0);
    expect(result.unknown.grantIds).toEqual([grant.id]);

    const risk = computeRiskScore(grant, {
      now: new Date("2026-08-30T00:00:00.000Z"),
    });
    expect(risk.score).toBe(100);
    expect(risk.reasons).toContain("AI agent is unregistered and holds live access (+45)");
  });

  it("does not attach an agent grant to a service-account cluster by shared key", () => {
    const grant = agentGrant({
      principal: {
        kind: "ai_agent",
        identifiers: [
          { kind: "agent_id", value: "declared-agent", source: "trueforge" },
          { kind: "key_id", value: "shared-key", source: "trueforge" },
        ],
        agentName: "Declared Agent",
        runtime: "TrueForge",
        reachableTools: ["keyring-mcp"],
        declarationStatus: "declared",
      },
    });
    const result = reconcileIdentities({
      grants: [grant],
      serviceAccounts: [
        {
          id: "ci",
          displayName: "CI",
          owner: "owner@keyring-test.example",
          keyIds: ["shared-key"],
          resourceIds: [grant.resource.id],
        },
      ],
      declaredAgents: [
        {
          id: "declared-agent",
          name: "Declared Agent",
          runtime: "TrueForge",
          owner: "owner@keyring-test.example",
          purpose: "Test purpose",
          agentIds: ["declared-agent"],
          keyIds: ["shared-key"],
        },
      ],
    });

    expect(result.clusters.map((cluster) => cluster.kind)).toEqual(["ai_agent"]);
  });
});
