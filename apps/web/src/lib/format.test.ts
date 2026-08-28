import { describe, expect, it } from "vitest";

import type { ApiCard } from "../api/types.js";
import { isUnattributed, sortCards, staleness } from "../lib/format.js";

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
});
