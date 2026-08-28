import { describe, expect, it } from "vitest";

import { estimateCostUsd, loadCostConfig } from "./config.js";
import { CostCapExceededError, ScanCostLedger } from "./ledger.js";

describe("ScanCostLedger", () => {
  it("accumulates tokens and cost", () => {
    const ledger = new ScanCostLedger(10);
    const snap = ledger.recordModelCall({
      role: "inventory",
      model: "openai/gpt-4o-mini",
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(snap.inputTokens).toBe(1_000_000);
    expect(snap.costUsd).toBeCloseTo(0.15, 5);
    expect(snap.capped).toBe(false);
  });

  it("stops cleanly when hard cap is exceeded", () => {
    const ledger = new ScanCostLedger(0.01);
    expect(() =>
      ledger.recordModelCall({
        role: "reasoning",
        model: "openai/gpt-4o",
        inputTokens: 100_000,
        outputTokens: 10_000,
      }),
    ).toThrow(CostCapExceededError);
    expect(ledger.snapshot().capped).toBe(true);
  });
});

describe("loadCostConfig", () => {
  it("loads role models from agent.json", () => {
    const cfg = loadCostConfig(true);
    expect(cfg.models.inventory).toContain("gpt-4o-mini");
    expect(cfg.models.reasoning).toContain("gpt-4o");
    expect(cfg.hardCapUsd).toBeGreaterThan(0);
  });

  it("estimates known model prices", () => {
    const c = estimateCostUsd("openai/gpt-4o-mini", 1_000_000, 1_000_000);
    expect(c).toBeCloseTo(0.15 + 0.6, 5);
  });
});
