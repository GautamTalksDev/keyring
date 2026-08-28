import { describe, expect, it } from "vitest";

import { asResourceId } from "./brand.js";
import { createGrant, computeGrantId, computePrincipalId, grantIdFor } from "./grant.js";
import type { Evidence } from "./evidence.js";

const baseEvidence: Evidence = {
  claim: "GitHub collaborator API lists login on repo",
  source: "github",
  confidence: "certain",
};

describe("grant ID determinism", () => {
  it("produces the same id for the same systemId + resourceId + principalId", () => {
    const a = computeGrantId({
      systemId: "github",
      resourceId: "org/repo",
      principalId: "principal-abc",
    });
    const b = computeGrantId({
      systemId: "github",
      resourceId: "org/repo",
      principalId: "principal-abc",
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when systemId changes", () => {
    const base = {
      resourceId: "org/repo",
      principalId: "principal-abc",
    };
    expect(computeGrantId({ ...base, systemId: "github" })).not.toBe(
      computeGrantId({ ...base, systemId: "slack" }),
    );
  });

  it("changes when resourceId changes", () => {
    const base = {
      systemId: "github",
      principalId: "principal-abc",
    };
    expect(computeGrantId({ ...base, resourceId: "org/a" })).not.toBe(
      computeGrantId({ ...base, resourceId: "org/b" }),
    );
  });

  it("changes when principalId changes", () => {
    const base = {
      systemId: "github",
      resourceId: "org/repo",
    };
    expect(computeGrantId({ ...base, principalId: "p1" })).not.toBe(
      computeGrantId({ ...base, principalId: "p2" }),
    );
  });

  it("is stable across identifier order on the principal", () => {
    const a = computePrincipalId({
      kind: "human",
      identifiers: [
        { kind: "work_email", value: "Ada@Example.COM", source: "okta" },
        { kind: "username", value: "ada", source: "github" },
      ],
    });
    const b = computePrincipalId({
      kind: "human",
      identifiers: [
        { kind: "username", value: "ada", source: "github" },
        { kind: "work_email", value: "Ada@Example.COM", source: "okta" },
      ],
    });
    expect(a).toBe(b);
  });

  it("normalizes email case for principal id", () => {
    const upper = computePrincipalId({
      kind: "human",
      identifiers: [{ kind: "work_email", value: "ADA@EXAMPLE.COM", source: "hr" }],
    });
    const lower = computePrincipalId({
      kind: "human",
      identifiers: [{ kind: "work_email", value: "ada@example.com", source: "hr" }],
    });
    expect(upper).toBe(lower);
  });

  it("createGrant assigns deterministic id matching grantIdFor", () => {
    const grant = createGrant({
      system: "github",
      principal: {
        kind: "human",
        identifiers: [{ kind: "username", value: "ada", source: "github" }],
      },
      resource: {
        id: "acme/widgets",
        displayName: "widgets",
        kind: "repo",
      },
      capability: "write",
      discoveredAt: new Date("2026-01-01T00:00:00.000Z"),
      revocable: { possible: true, reversible: true, method: "remove_collaborator" },
      evidence: [baseEvidence],
    });

    expect(grant.id).toBe(
      grantIdFor({
        system: "github",
        resource: { id: asResourceId("acme/widgets") },
        principal: grant.principal,
      }),
    );
  });

  it("re-scan with same parts dedupes to the same grant id", () => {
    const input = {
      system: "google_workspace" as const,
      principal: {
        kind: "human" as const,
        identifiers: [
          { kind: "work_email" as const, value: "ada@acme.com", source: "workspace" },
        ],
      },
      resource: {
        id: "folders/abc",
        displayName: "Finance",
        kind: "drive_folder" as const,
      },
      capability: "admin" as const,
      discoveredAt: new Date("2026-02-01T00:00:00.000Z"),
      revocable: {
        possible: true,
        reversible: true,
        method: "drive.permissions.delete",
      },
      evidence: [baseEvidence],
    };

    const first = createGrant(input);
    const second = createGrant({
      ...input,
      discoveredAt: new Date("2026-03-01T00:00:00.000Z"),
    });
    expect(first.id).toBe(second.id);
  });

  it("rejects empty evidence — we must not assert without provenance", () => {
    expect(() =>
      createGrant({
        system: "slack",
        principal: { kind: "unknown", identifiers: [] },
        resource: { id: "C123", displayName: "#secrets", kind: "channel" },
        capability: "read",
        discoveredAt: new Date("2026-01-01T00:00:00.000Z"),
        revocable: { possible: true, reversible: true, method: "kick" },
        evidence: [],
      }),
    ).toThrow(/Evidence is mandatory/);
  });
});
