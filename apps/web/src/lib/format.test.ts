import { describe, expect, it } from "vitest";

import type { ApiCard } from "../api/types.js";
import {
  countScanSummary,
  isUnattributed,
  scanSummaryText,
  sortCards,
  staleness,
} from "../lib/format.js";

function card(partial: Partial<ApiCard> & Pick<ApiCard, "id">): ApiCard {
  return {
    status: "pending",
    proposedAction: { kind: "revoke", description: "Revoke" },
    irreversible: false,
    risk: { score: 50, reasons: ["capability admin (+55)"] },
    attribution: {
      confidence: "certain",
      reasoning: "Matched work email.",
      resolvedTo: "person-1",
    },
    decision: null,
    grant: {
      id: `g-${partial.id}`,
      system: "github",
      capability: "admin",
      resource: { id: "r", displayName: "repo", kind: "repo" },
      principal: {
        kind: "human",
        identifiers: [{ kind: "work_email", value: "a@x.com", source: "hr" }],
      },
      evidence: [{ claim: "acl", source: "fixture", confidence: "certain" }],
      revocable: { possible: true, reversible: true, method: "api" },
      lastUsedAt: null,
      discoveredAt: "2026-01-01T00:00:00.000Z",
      createdAt: null,
    },
    ...partial,
  };
}

describe("format helpers", () => {
  it("pins unattributed ahead of attributed when sorting", () => {
    const a = card({
      id: "attr",
      risk: { score: 10, reasons: [] },
      attribution: {
        confidence: "certain",
        reasoning: "ok",
        resolvedTo: "p1",
      },
    });
    const u = card({
      id: "unk",
      risk: { score: 1, reasons: [] },
      attribution: { confidence: "speculative", reasoning: "unknown bucket" },
      grant: {
        ...card({ id: "unk" }).grant,
        principal: { kind: "unknown", identifiers: [] },
      },
    });
    expect(isUnattributed(u)).toBe(true);
    expect(isUnattributed(a)).toBe(false);
    expect(sortCards([a, u]).map((c) => c.id)).toEqual(["unk", "attr"]);
  });

  it("flags missing lastUsedAt as unknown staleness", () => {
    expect(staleness(null).level).toBe("unknown");
  });

  it("counts summary findings from cards and connected systems", () => {
    const counts = countScanSummary(
      [
        card({ id: "unknown", attribution: { confidence: "speculative", reasoning: "unknown" } }),
        card({
          id: "old",
          irreversible: true,
          grant: {
            ...card({ id: "old-base" }).grant,
            lastUsedAt: "2024-01-01T00:00:00.000Z",
          },
        }),
      ],
      ["github", "slack", "aws"],
      new Date("2026-06-01T00:00:00.000Z"),
    );

    expect(counts).toEqual({
      grants: 2,
      systems: 3,
      humanIdentities: 2,
      agentIdentities: 0,
      unattributed: 1,
      overYearIdle: 1,
      irreversible: 1,
    });
    expect(scanSummaryText(counts)).toBe(
      "2 grants across 3 systems. 2 human identities and 0 AI agent identities. 1 we cannot attribute to anyone. 1 not used in over a year. 1 is irreversible to revoke.",
    );
  });

  it("omits zero-category clauses from the headline", () => {
    const counts = countScanSummary([card({ id: "one" })], ["github"]);

    expect(counts.unattributed).toBe(0);
    expect(counts.humanIdentities).toBe(1);
    expect(counts.agentIdentities).toBe(0);
    expect(counts.overYearIdle).toBe(0);
    expect(counts.irreversible).toBe(0);
    expect(scanSummaryText(counts)).toBe(
      "1 grant across 1 system. 1 human identity and 0 AI agent identities.",
    );
  });

  it("counts AI agents separately from human identities", () => {
    const agent = card({
      id: "agent",
      attribution: {
        confidence: "certain",
        reasoning: "TrueForge registration",
        resolvedTo: "agent-1",
      },
      grant: {
        ...card({ id: "agent-base" }).grant,
        principal: {
          kind: "ai_agent",
          agentName: "Keyring",
          runtime: "TrueForge",
          declarationStatus: "declared",
          identifiers: [{ kind: "agent_id", value: "keyring-self", source: "trueforge" }],
        },
      },
    });
    const counts = countScanSummary([card({ id: "human" }), agent], ["github", "agent_identity"]);
    expect(counts.humanIdentities).toBe(1);
    expect(counts.agentIdentities).toBe(1);
    expect(scanSummaryText(counts)).toContain("1 human identity and 1 AI agent identity");
  });
});
