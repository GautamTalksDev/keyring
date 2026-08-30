import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { ScanRecording } from "./types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("checked-in recordings", () => {
  it("keeps Ada and service-account grant ownership disjoint", async () => {
    const recording = JSON.parse(
      await readFile(path.join(repoRoot, "fixtures/recordings/ada-lovelace.json"), "utf8"),
    ) as ScanRecording;
    const reconciliation = recording.reconciliation;

    expect(reconciliation).not.toBeNull();
    if (!reconciliation) return;

    const clusterIds = reconciliation.clusters.flatMap((cluster) => cluster.grantIds);
    const unknownIds = reconciliation.unknown.grantIds;
    expect(new Set(clusterIds).size).toBe(clusterIds.length);
    expect(clusterIds.some((id) => unknownIds.includes(id))).toBe(false);
    expect(new Set([...clusterIds, ...unknownIds])).toEqual(new Set(recording.grantIds));

    const cards = recording.cards as Array<{
      grantId: string;
      attribution?: { resolvedTo?: string };
    }>;
    const ownerByGrant = new Map(
      reconciliation.clusters.flatMap((cluster) =>
        cluster.grantIds.map((grantId) => [grantId, cluster.personId] as const),
      ),
    );
    for (const card of cards) {
      const owner = ownerByGrant.get(card.grantId);
      if (owner) {
        expect(card.attribution?.resolvedTo).toBe(owner);
      } else {
        expect(unknownIds).toContain(card.grantId);
        expect(card.attribution?.resolvedTo).toBeUndefined();
      }
    }
  });
});
