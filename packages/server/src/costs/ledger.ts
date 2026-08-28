import {
  estimateCostUsd,
  loadCostConfig,
  modelForRole,
  type ModelRole,
} from "./config.js";

export interface ModelUsageLine {
  at: string;
  role: ModelRole | "other";
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  note?: string;
}

export interface ScanCostSnapshot {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  hardCapUsd: number;
  capped: boolean;
  lines: ModelUsageLine[];
}

export class CostCapExceededError extends Error {
  readonly costUsd: number;
  readonly hardCapUsd: number;

  constructor(costUsd: number, hardCapUsd: number) {
    super(
      `Scan spend cap reached ($${costUsd.toFixed(4)} / $${hardCapUsd.toFixed(2)}). Stopping cleanly.`,
    );
    this.name = "CostCapExceededError";
    this.costUsd = costUsd;
    this.hardCapUsd = hardCapUsd;
  }
}

/**
 * Per-scan token + cost ledger. Never logs API keys.
 */
export class ScanCostLedger {
  private inputTokens = 0;
  private outputTokens = 0;
  private costUsd = 0;
  private capped = false;
  private readonly lines: ModelUsageLine[] = [];
  private readonly hardCapUsd: number;

  constructor(hardCapUsd?: number) {
    this.hardCapUsd = hardCapUsd ?? loadCostConfig().hardCapUsd;
  }

  snapshot(): ScanCostSnapshot {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      costUsd: Number(this.costUsd.toFixed(6)),
      hardCapUsd: this.hardCapUsd,
      capped: this.capped,
      lines: [...this.lines],
    };
  }

  /**
   * Record a model call. Throws {@link CostCapExceededError} if the cap is hit
   * (after recording the line that crossed it).
   */
  recordModelCall(input: {
    role: ModelRole | "other";
    model?: string;
    inputTokens: number;
    outputTokens: number;
    note?: string;
    at?: string;
  }): ScanCostSnapshot {
    if (this.capped) {
      throw new CostCapExceededError(this.costUsd, this.hardCapUsd);
    }

    const model =
      input.model ??
      (input.role === "other"
        ? loadCostConfig().defaultModel
        : modelForRole(input.role));
    const cost = estimateCostUsd(model, input.inputTokens, input.outputTokens);
    this.inputTokens += input.inputTokens;
    this.outputTokens += input.outputTokens;
    this.costUsd += cost;
    this.lines.push({
      at: input.at ?? new Date().toISOString(),
      role: input.role,
      model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costUsd: Number(cost.toFixed(6)),
      ...(input.note ? { note: input.note } : {}),
    });

    if (this.costUsd >= this.hardCapUsd) {
      this.capped = true;
      throw new CostCapExceededError(this.costUsd, this.hardCapUsd);
    }
    return this.snapshot();
  }

  /** Check whether adding tokens would exceed the cap (without recording). */
  wouldExceed(inputTokens: number, outputTokens: number, model: string): boolean {
    const next = this.costUsd + estimateCostUsd(model, inputTokens, outputTokens);
    return next >= this.hardCapUsd;
  }
}
