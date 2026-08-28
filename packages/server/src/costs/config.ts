import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ModelRole = "inventory" | "reasoning";

export interface RoleModels {
  /** Cheap model for mechanical subagent inventory summarisation. */
  inventory: string;
  /** Stronger model for reconciliation + risk reasoning. */
  reasoning: string;
}

export interface CostConfig {
  /** Stop the scan cleanly when estimated spend reaches this USD amount. */
  hardCapUsd: number;
  /** USD per 1M input tokens, keyed by model FQN. */
  inputUsdPer1M: Record<string, number>;
  /** USD per 1M output tokens, keyed by model FQN. */
  outputUsdPer1M: Record<string, number>;
  models: RoleModels;
  /** Default TrueForge agent model FQN (usually the inventory/cheap model). */
  defaultModel: string;
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

const DEFAULTS: CostConfig = {
  hardCapUsd: 0.5,
  defaultModel: "openai/gpt-4o-mini",
  models: {
    inventory: "openai/gpt-4o-mini",
    reasoning: "openai/gpt-4o",
  },
  inputUsdPer1M: {
    "openai/gpt-4o-mini": 0.15,
    "openai/gpt-4o": 2.5,
    "anthropic/claude-haiku-4-5": 1.0,
    "anthropic/claude-sonnet-4-6": 3.0,
  },
  outputUsdPer1M: {
    "openai/gpt-4o-mini": 0.6,
    "openai/gpt-4o": 10.0,
    "anthropic/claude-haiku-4-5": 5.0,
    "anthropic/claude-sonnet-4-6": 15.0,
  },
};

interface AgentFile {
  model?: { name?: string };
  keyring?: {
    models?: Partial<RoleModels>;
    costs?: {
      hard_cap_usd?: number;
      input_usd_per_1m?: Record<string, number>;
      output_usd_per_1m?: Record<string, number>;
    };
  };
}

let cached: CostConfig | null = null;

export function loadCostConfig(force = false): CostConfig {
  if (cached && !force) return cached;

  let file: AgentFile = {};
  try {
    const raw = readFileSync(
      path.join(repoRoot, "agents/keyring.agent.json"),
      "utf8",
    );
    file = JSON.parse(raw) as AgentFile;
  } catch {
    /* defaults */
  }

  const hardCapEnv = process.env.KEYRING_HARD_CAP_USD;
  const hardCapUsd =
    hardCapEnv !== undefined && hardCapEnv !== ""
      ? Number(hardCapEnv)
      : (file.keyring?.costs?.hard_cap_usd ?? DEFAULTS.hardCapUsd);

  cached = {
    hardCapUsd: Number.isFinite(hardCapUsd) ? hardCapUsd : DEFAULTS.hardCapUsd,
    defaultModel: file.model?.name ?? DEFAULTS.defaultModel,
    models: {
      inventory:
        file.keyring?.models?.inventory ??
        process.env.KEYRING_MODEL_INVENTORY ??
        DEFAULTS.models.inventory,
      reasoning:
        file.keyring?.models?.reasoning ??
        process.env.KEYRING_MODEL_REASONING ??
        DEFAULTS.models.reasoning,
    },
    inputUsdPer1M: {
      ...DEFAULTS.inputUsdPer1M,
      ...(file.keyring?.costs?.input_usd_per_1m ?? {}),
    },
    outputUsdPer1M: {
      ...DEFAULTS.outputUsdPer1M,
      ...(file.keyring?.costs?.output_usd_per_1m ?? {}),
    },
  };
  return cached;
}

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cfg = loadCostConfig(),
): number {
  const inRate = cfg.inputUsdPer1M[model] ?? cfg.inputUsdPer1M[cfg.defaultModel] ?? 1;
  const outRate =
    cfg.outputUsdPer1M[model] ?? cfg.outputUsdPer1M[cfg.defaultModel] ?? 1;
  return (inputTokens / 1_000_000) * inRate + (outputTokens / 1_000_000) * outRate;
}

export function modelForRole(role: ModelRole, cfg = loadCostConfig()): string {
  return cfg.models[role];
}
