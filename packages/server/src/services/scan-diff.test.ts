import { describe, expect, it } from "vitest";

import { diffGrantSnapshots, filterCardsToDiff } from "./scan-diff.js";

describe("scan diff", () => {
  it("reports added and removed grants", () => {
    const diff = diffGrantSnapshots(
      { scanId: "b", grantIds: ["1", "2", "3"] },
      { scanId: "a", grantIds: ["1", "4"] },
    );
    expect(diff.added).toEqual(["2", "3"]);
    expect(diff.removed).toEqual(["4"]);
    expect(diff.unchanged).toEqual(["1"]);
  });

  it("filters cards to new/changed when baseline exists", () => {
    const diff = diffGrantSnapshots(
      { scanId: "b", grantIds: ["new", "old"] },
      { scanId: "a", grantIds: ["old"] },
    );
    const cards = [
      { grant: { id: "new" }, status: "pending" },
      { grant: { id: "old" }, status: "pending" },
      { grant: { id: "old" }, status: "held", protected: true },
    ];
    const filtered = filterCardsToDiff(cards, diff);
    expect(filtered.map((c) => c.grant.id)).toEqual(["new", "old"]);
  });
});
