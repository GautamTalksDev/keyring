import { describe, expect, it } from "vitest";

import { isCurrentGuidedRun, isTerminalScanStatus } from "./useGuidedDemo.js";

describe("guided demo run guards", () => {
  it("does not apply a decision result from a superseded run", () => {
    expect(isCurrentGuidedRun(4, 5, false)).toBe(false);
    expect(isCurrentGuidedRun(5, 5, true)).toBe(false);
    expect(isCurrentGuidedRun(5, 5, false)).toBe(true);
  });

  it("treats every non-active scan status as terminal", () => {
    expect(isTerminalScanStatus("idle")).toBe(false);
    expect(isTerminalScanStatus("running")).toBe(false);
    expect(isTerminalScanStatus("completed")).toBe(true);
    expect(isTerminalScanStatus("partial")).toBe(true);
    expect(isTerminalScanStatus("failed")).toBe(true);
    expect(isTerminalScanStatus("cost_capped")).toBe(true);
  });
});
