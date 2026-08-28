import type { ScanProgressEvent } from "../api/progress.js";
import type { ScanCostSnapshot } from "../costs/ledger.js";
import type {
  RecordedInteraction,
  RecordedModelInteraction,
  RecordedToolInteraction,
  ScanRecording,
} from "./types.js";

export class ScanRecorder {
  readonly interactions: RecordedInteraction[] = [];
  readonly events: ScanProgressEvent[] = [];

  addEvent(event: ScanProgressEvent): void {
    this.events.push(event);
  }

  addModel(line: Omit<RecordedModelInteraction, "kind">): void {
    this.interactions.push({ kind: "model", ...line });
  }

  addTool(line: Omit<RecordedToolInteraction, "kind">): void {
    this.interactions.push({ kind: "tool", ...line });
  }

  build(input: {
    id: string;
    person: string | null;
    scope: string | null;
    driver: string;
    models: { inventory: string; reasoning: string };
    costs: ScanCostSnapshot;
    cards: unknown[];
    reconciliation: ScanRecording["reconciliation"];
    grantIds: string[];
  }): ScanRecording {
    return {
      version: 1,
      id: input.id,
      recordedAt: new Date().toISOString(),
      person: input.person,
      scope: input.scope,
      driver: input.driver,
      models: input.models,
      interactions: [...this.interactions],
      events: [...this.events],
      costs: input.costs,
      cards: input.cards,
      reconciliation: input.reconciliation,
      grantIds: input.grantIds,
    };
  }
}
