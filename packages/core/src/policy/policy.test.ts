import { describe, expect, it } from "vitest";

import { buildApprovalCards } from "../approval-build.js";
import { createGrant } from "../grant.js";
import { CI_TRAP_MARKER } from "../identity/trap.js";
import { reconcileIdentities } from "../identity/reconcile.js";
import { declaredAgentsFromPolicy, normalizePolicy } from "./apply.js";
import { runReconciliationFromJson } from "../identity/run.js";

const CI_KEY = "AKIA_KEYRING_CI_ORPHAN_LOOKALIKE";

describe("keyring.yml policy", () => {
  it("normalizes declared agents with an owner and purpose", () => {
    const policy = normalizePolicy({
      declared_agents: [
        {
          id: "billing-reconciler",
          name: "Billing Reconciler",
          runtime: "TrueForge",
          owner: "owner@keyring-test.example",
          purpose: "Reconcile billing grants",
          agent_ids: ["billing-reconciler"],
        },
      ],
    });

    expect(declaredAgentsFromPolicy(policy)).toEqual(policy.declared_agents);
    expect(policy.declared_agents[0]).toMatchObject({
      owner: "owner@keyring-test.example",
      purpose: "Reconcile billing grants",
    });
  });

  it("attributes the CI trap key to a declared service account (not unknown)", () => {
    const trap = createGrant({
      system: "github",
      capability: "admin",
      principal: {
        kind: "unknown",
        identifiers: [{ kind: "key_id", value: CI_KEY, source: "github" }],
      },
      resource: {
        id: "keyring-test/payments",
        displayName: "payments",
        kind: "repo",
      },
      discoveredAt: new Date("2026-01-01T00:00:00.000Z"),
      revocable: {
        possible: true,
        reversible: false,
        method: "repos.delete_deploy_key",
      },
      evidence: [
        {
          source: "fixture",
          confidence: "certain",
          claim: `TRAP/${CI_TRAP_MARKER}: CI deploy key`,
        },
      ],
    });

    const policy = normalizePolicy({
      service_accounts: [
        {
          id: "ci-payments-cdn",
          display_name: "GitHub Actions — payments CDN publish",
          owner: "platform@keyring-test.example",
          key_ids: [CI_KEY],
          resource_ids: ["keyring-test/payments"],
        },
      ],
      protected: [
        {
          resource: "keyring-test/payments",
          system: "github",
          reason: "Prod payments CDN",
        },
      ],
    });

    const reconciliation = reconcileIdentities({
      grants: [trap],
      directory: [],
      serviceAccounts: policy.service_accounts.map((sa) => ({
        id: sa.id,
        displayName: sa.display_name,
        owner: sa.owner,
        keyIds: sa.key_ids,
        resourceIds: sa.resource_ids,
      })),
    });

    expect(reconciliation.unknown.grantIds).toHaveLength(0);
    expect(reconciliation.clusters).toHaveLength(1);
    expect(reconciliation.clusters[0]!.kind).toBe("service_account");
    expect(reconciliation.clusters[0]!.displayName).toMatch(/payments CDN/i);
    expect(reconciliation.clusters[0]!.personId).toBeTruthy();
    expect(reconciliation.clusters[0]!.reasoning).toMatch(/keyring\.yml/i);

    const cards = buildApprovalCards({
      grants: [trap],
      reconciliation,
      policy,
    });
    expect(cards[0]!.attribution.resolvedTo).toBeTruthy();
    expect(cards[0]!.status).toBe("held");
    expect(cards[0]!.protected).toBe(true);
  });

  it("never auto-approves when auto_approve.enabled is false", () => {
    const grant = createGrant({
      system: "slack",
      capability: "read",
      principal: {
        kind: "human",
        identifiers: [
          { kind: "work_email", value: "ada@test.example", source: "slack" },
        ],
      },
      resource: { id: "C1", displayName: "#general", kind: "other" },
      discoveredAt: new Date("2026-01-01T00:00:00.000Z"),
      lastUsedAt: new Date("2026-08-01T00:00:00.000Z"),
      revocable: {
        possible: true,
        reversible: true,
        method: "conversations.kick",
      },
      evidence: [
        { claim: "member", source: "fixture", confidence: "certain" },
      ],
    });
    const reconciliation = runReconciliationFromJson({
      grants: [grant],
      directory: [
        {
          displayName: "Ada",
          workEmails: ["ada@test.example"],
        },
      ],
    });
    const policy = normalizePolicy({
      auto_approve: {
        enabled: false,
        rules: [
          {
            id: "safe-read",
            description: "read",
            max_capability: "read",
            max_risk: 100,
          },
        ],
      },
    });
    const cards = buildApprovalCards({ grants: [grant], reconciliation, policy });
    expect(cards[0]!.autoApprovedBy).toBeUndefined();
    expect(cards[0]!.status).toBe("pending");
  });

  it("records which auto-approve rule fired when enabled", () => {
    const grant = createGrant({
      system: "slack",
      capability: "read",
      principal: {
        kind: "human",
        identifiers: [
          { kind: "work_email", value: "ada@test.example", source: "slack" },
        ],
      },
      resource: { id: "C1", displayName: "#general", kind: "other" },
      discoveredAt: new Date("2026-01-01T00:00:00.000Z"),
      lastUsedAt: new Date("2026-08-01T00:00:00.000Z"),
      revocable: {
        possible: true,
        reversible: true,
        method: "conversations.kick",
      },
      evidence: [
        { claim: "member", source: "fixture", confidence: "certain" },
      ],
    });
    const reconciliation = runReconciliationFromJson({
      grants: [grant],
      directory: [
        {
          displayName: "Ada",
          workEmails: ["ada@test.example"],
        },
      ],
    });
    const policy = normalizePolicy({
      auto_approve: {
        enabled: true,
        rules: [
          {
            id: "safe-read-reversible",
            description: "Reversible read-only under risk 80",
            max_capability: "read",
            reversible_only: true,
            max_risk: 80,
          },
        ],
      },
    });
    const cards = buildApprovalCards({ grants: [grant], reconciliation, policy });
    expect(cards[0]!.status).toBe("approved");
    expect(cards[0]!.autoApprovedBy).toBe("safe-read-reversible");
    expect(cards[0]!.decision?.by).toBe("policy:safe-read-reversible");
  });
});
