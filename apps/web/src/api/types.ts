export type Confidence = "certain" | "probable" | "speculative";

export type ApprovalStatus = "pending" | "approved" | "held" | "rejected";

export interface ApiCard {
  id: string;
  status: ApprovalStatus;
  proposedAction: {
    kind: "revoke" | "downgrade" | "transfer_ownership" | "flag_only";
    description: string;
  };
  irreversible: boolean;
  protected?: boolean;
  protectedReason?: string | null;
  autoApprovedBy?: string | null;
  risk: { score: number; reasons: string[] };
  attribution: {
    resolvedTo?: string;
    confidence: Confidence;
    reasoning: string;
  };
  decision: { by: string; at: string; note?: string } | null;
  grant: {
    id: string;
    system: string;
    capability: string;
    resource: { id: string; displayName: string; kind: string };
    principal: {
      kind: string;
      identifiers: Array<{ kind: string; value: string; source: string }>;
    };
    evidence: Array<{ claim: string; source: string; confidence: string }>;
    revocable: { possible: boolean; reversible: boolean; method: string };
    lastUsedAt: string | null;
    discoveredAt: string;
    createdAt?: string | null;
  };
}

export type ScanProgressEvent = {
  type: string;
  scanId: string;
  at: string;
  [key: string]: unknown;
};

export interface SubagentState {
  systemId: string;
  displayName: string;
  status: "queued" | "scanning" | "reconciling" | "done";
  found: number;
  startedAt: string;
}

export interface ScanCostSnapshot {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  hardCapUsd: number;
  capped: boolean;
}

export interface AgentActivityState {
  scanId: string | null;
  status: "idle" | "running" | "completed" | "failed" | "cost_capped" | "partial";
  person: string | null;
  subagents: Record<string, SubagentState>;
  sandbox: { active: boolean; label: string | null; detail: string | null };
  log: Array<{ at: string; text: string; kind: "info" | "sandbox" | "warn" }>;
  error: string | null;
  errorKind: string | null;
  recovery: string | null;
  grantsDiscovered: number | null;
  costs: ScanCostSnapshot | null;
  driver: string | null;
  recordingId: string | null;
}

export interface ExecuteResult {
  cardId: string;
  status: "success" | "failed" | "skipped" | "dry_run";
  error?: string;
  detail?: string;
  errorKind?: string;
  recovery?: string;
  restorable?: boolean;
  undoHint?: {
    permission: string;
    restoreMethod: string;
    params: Record<string, unknown>;
  };
}
