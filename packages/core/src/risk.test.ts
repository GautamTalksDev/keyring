import { describe, expect, it } from "vitest";

import { createGrant, type Grant } from "./grant.js";
import { computeRiskScore } from "./risk.js";

const now = new Date("2026-06-01T00:00:00.000Z");

function baseGrant(overrides: Partial<Parameters<typeof createGrant>[0]> = {}): Grant {
  return createGrant({
    system: "github",
    principal: {
      kind: "human",
      identifiers: [{ kind: "username", value: "ada", source: "github" }],
    },
    resource: { id: "acme/widgets", displayName: "widgets", kind: "repo" },
    capability: "read",
    lastUsedAt: new Date("2026-05-20T00:00:00.000Z"),
    discoveredAt: new Date("2026-05-01T00:00:00.000Z"),
    revocable: { possible: true, reversible: true, method: "remove_collaborator" },
    evidence: [
      {
        claim: "collaborator listed",
        source: "github",
        confidence: "certain",
      },
    ],
    ...overrides,
  });
}

describe("risk scoring", () => {
  it("scores a low-risk recent read grant near the capability floor", () => {
    const risk = computeRiskScore(baseGrant(), { now });
    expect(risk.score).toBe(10);
    expect(risk.reasons.some((r) => r.includes("capability read"))).toBe(true);
    expect(risk.reasons.some((r) => r.includes("recent"))).toBe(true);
    expect(risk.reasons.some((r) => r.includes("principal resolved"))).toBe(true);
  });

  it("increases score for higher capability", () => {
    const read = computeRiskScore(baseGrant({ capability: "read" }), { now });
    const write = computeRiskScore(baseGrant({ capability: "write" }), { now });
    const admin = computeRiskScore(baseGrant({ capability: "admin" }), { now });
    const owner = computeRiskScore(baseGrant({ capability: "owner" }), { now });
    expect(read.score).toBeLessThan(write.score);
    expect(write.score).toBeLessThan(admin.score);
    expect(admin.score).toBeLessThan(owner.score);
  });

  it("penalizes missing lastUsedAt", () => {
    const withUse = computeRiskScore(baseGrant(), { now });
    const without = computeRiskScore(baseGrant({ lastUsedAt: undefined }), { now });
    expect(without.score).toBeGreaterThan(withUse.score);
    expect(without.reasons.some((r) => r.includes("lastUsedAt unknown"))).toBe(true);
  });

  it("penalizes stale lastUsedAt in tiers", () => {
    const recent = computeRiskScore(
      baseGrant({ lastUsedAt: new Date("2026-05-20T00:00:00.000Z") }),
      { now },
    );
    const cooling = computeRiskScore(
      baseGrant({ lastUsedAt: new Date("2026-04-01T00:00:00.000Z") }),
      { now },
    );
    const stale = computeRiskScore(
      baseGrant({ lastUsedAt: new Date("2025-12-01T00:00:00.000Z") }),
      { now },
    );
    const ancient = computeRiskScore(
      baseGrant({ lastUsedAt: new Date("2024-01-01T00:00:00.000Z") }),
      { now },
    );
    expect(recent.score).toBeLessThan(cooling.score);
    expect(cooling.score).toBeLessThan(stale.score);
    expect(stale.score).toBeLessThan(ancient.score);
    expect(ancient.reasons.some((r) => r.includes("highly stale"))).toBe(true);
  });

  it("penalizes irreversible and impossible revocation", () => {
    const reversible = computeRiskScore(baseGrant(), { now });
    const irreversible = computeRiskScore(
      baseGrant({
        revocable: { possible: true, reversible: false, method: "hard_delete" },
      }),
      { now },
    );
    const impossible = computeRiskScore(
      baseGrant({
        revocable: { possible: false, reversible: false, method: "n/a" },
      }),
      { now },
    );
    expect(irreversible.score).toBeGreaterThan(reversible.score);
    expect(impossible.score).toBeGreaterThan(irreversible.score);
    expect(irreversible.reasons.some((r) => r.includes("irreversible"))).toBe(true);
    expect(impossible.reasons.some((r) => r.includes("not possible"))).toBe(true);
  });

  it("penalizes unknown principal and empty identifiers", () => {
    const known = computeRiskScore(baseGrant(), { now });
    const unknown = computeRiskScore(
      baseGrant({
        principal: {
          kind: "unknown",
          identifiers: [{ kind: "key_id", value: "AKIA...", source: "aws" }],
        },
      }),
      { now },
    );
    const noIds = computeRiskScore(
      baseGrant({
        principal: { kind: "human", identifiers: [] },
      }),
      { now },
    );
    expect(unknown.score).toBeGreaterThan(known.score);
    expect(noIds.score).toBeGreaterThan(known.score);
    expect(unknown.reasons.some((r) => r.includes("unresolved"))).toBe(true);
    expect(noIds.reasons.some((r) => r.includes("no identifiers"))).toBe(true);
  });

  it("uses reconciled ownership and confidence instead of raw principal kind", () => {
    const unattributed = computeRiskScore(
      baseGrant({
        principal: {
          kind: "unknown",
          identifiers: [{ kind: "key_id", value: "AKIA...", source: "aws" }],
        },
      }),
      { now },
    );
    const probableHuman = computeRiskScore(
      baseGrant({
        principal: {
          kind: "unknown",
          identifiers: [{ kind: "username", value: "ada", source: "github" }],
        },
      }),
      {
        now,
        attribution: { kind: "human", confidence: "probable" },
      },
    );
    const certainServiceAccount = computeRiskScore(
      baseGrant({
        principal: {
          kind: "unknown",
          identifiers: [{ kind: "key_id", value: "CI_KEY", source: "github" }],
        },
      }),
      {
        now,
        attribution: { kind: "service_account", confidence: "certain" },
      },
    );

    expect(unattributed.score).toBeGreaterThan(probableHuman.score);
    expect(probableHuman.score).toBeGreaterThan(certainServiceAccount.score);
    expect(unattributed.reasons.some((r) => r.includes("unresolved"))).toBe(true);
    expect(probableHuman.reasons).toContain("principal resolved as human (probable) (+5)");
    expect(certainServiceAccount.reasons).toContain(
      "principal resolved as service_account (certain) (+0)",
    );
  });

  it("caps score at 100 and always returns reasons", () => {
    const risk = computeRiskScore(
      baseGrant({
        capability: "owner",
        lastUsedAt: new Date("2020-01-01T00:00:00.000Z"),
        principal: { kind: "unknown", identifiers: [] },
        revocable: { possible: false, reversible: false, method: "n/a" },
      }),
      { now },
    );
    expect(risk.score).toBe(100);
    expect(risk.reasons.length).toBeGreaterThan(0);
  });
});
