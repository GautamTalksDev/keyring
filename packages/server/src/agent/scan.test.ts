import { describe, expect, it } from "vitest";

import { listConnectedSystems, runFixtureScanPipeline } from "./scan.js";

describe("fixture scan fan-out", () => {
  it("lists one connected system per fixture source", async () => {
    const systems = await listConnectedSystems();
    expect(systems.map((s) => s.id).sort()).toEqual([
      "aws",
      "github",
      "google_workspace",
      "notion",
      "slack",
    ]);
    expect(systems.every((s) => s.mode === "scan")).toBe(true);
  });

  it("reconciles and builds cards without revoking", async () => {
    const result = await runFixtureScanPipeline();
    expect(result.systems.length).toBe(5);
    expect(result.grants.length).toBeGreaterThan(0);
    expect(result.reconciliation.clusters.length).toBe(4); // 3 people + CI service account
    expect(result.reconciliation.unknown.grantIds.length).toBeGreaterThanOrEqual(1);
    expect(result.cards.length).toBe(result.grants.length);
    expect(result.cards.some((c) => c.status === "held")).toBe(true);
    // Checkpoint 12: CI trap key is attributed via keyring.yml, not Unattributed
    const ciCard = result.cards.find((c) =>
      c.grant.principal.identifiers.some(
        (i) => i.value === "AKIA_KEYRING_CI_ORPHAN_LOOKALIKE",
      ),
    );
    expect(ciCard?.attribution.resolvedTo).toBeTruthy();
    expect(ciCard?.protected).toBe(true);
  });
});
