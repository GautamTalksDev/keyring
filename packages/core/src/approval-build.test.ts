import { buildApprovalCards } from "./approval-build.js";
import { createGrant } from "./grant.js";
import { CI_TRAP_MARKER } from "./identity/trap.js";
import { runReconciliationFromJson } from "./identity/run.js";
import { describe, expect, it } from "vitest";

describe("buildApprovalCards", () => {
  it("holds CI trap grants as flag_only", () => {
    const trap = createGrant({
      system: "github",
      capability: "admin",
      principal: {
        kind: "unknown",
        identifiers: [{ kind: "key_id", value: "AKIA_TRAP", source: "aws" }],
      },
      resource: {
        id: "repo",
        displayName: "payments",
        kind: "repo",
      },
      discoveredAt: new Date("2026-01-01T00:00:00.000Z"),
      revocable: { possible: true, reversible: false, method: "fixture" },
      evidence: [
        {
          source: "fixture",
          confidence: "certain",
          claim: `TRAP/${CI_TRAP_MARKER}: do not revoke`,
        },
      ],
    });

    const reconciliation = runReconciliationFromJson({
      grants: [trap],
      directory: [],
    });
    const cards = buildApprovalCards({ grants: [trap], reconciliation });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.proposedAction.kind).toBe("flag_only");
    expect(cards[0]!.status).toBe("held");
  });
});
