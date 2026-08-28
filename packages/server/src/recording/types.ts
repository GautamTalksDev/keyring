import type { ApprovalCard, ReconciliationResult } from "@keyring/core";

import type { ScanProgressEvent } from "../api/progress.js";
import type { ScanCostSnapshot } from "../costs/ledger.js";

export interface RecordedModelInteraction {
  kind: "model";
  at: string;
  role: "inventory" | "reasoning" | "other";
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Redacted prompt summary — never secrets. */
  inputSummary: string;
  outputSummary: string;
}

export interface RecordedToolInteraction {
  kind: "tool";
  at: string;
  tool: string;
  arguments: unknown;
  resultSummary: string;
}

export type RecordedInteraction =
  | RecordedModelInteraction
  | RecordedToolInteraction;

export interface ScanRecording {
  version: 1;
  id: string;
  recordedAt: string;
  person: string | null;
  scope: string | null;
  driver: string;
  models: { inventory: string; reasoning: string };
  interactions: RecordedInteraction[];
  events: ScanProgressEvent[];
  costs: ScanCostSnapshot;
  /** Serialized approval cards as returned by the API. */
  cards: unknown[];
  reconciliation: ReconciliationResult | null;
  grantIds: string[];
}

export function recordingIdFromPerson(person: string): string {
  return person
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

export type { ApprovalCard };
