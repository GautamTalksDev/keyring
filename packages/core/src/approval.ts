import type { ApprovalCardId, PersonId, PrincipalId } from "./brand.js";
import type { Confidence } from "./evidence.js";
import type { Grant } from "./grant.js";
import type { RiskScore } from "./risk.js";

export type ProposedActionKind = "revoke" | "downgrade" | "transfer_ownership" | "flag_only";

export type ProposedAction =
  | { kind: "revoke"; description: string }
  | { kind: "downgrade"; description: string }
  | { kind: "transfer_ownership"; description: string }
  | { kind: "flag_only"; description: string };

export type ApprovalStatus = "pending" | "approved" | "held" | "rejected";

export interface Attribution {
  resolvedTo?: PersonId | PrincipalId;
  confidence: Confidence;
  reasoning: string;
}

export interface Decision {
  by: string;
  at: Date;
  note?: string;
}

/**
 * What a human sees and decides on in the approval queue.
 */
export interface ApprovalCard {
  id: ApprovalCardId;
  grant: Grant;
  proposedAction: ProposedAction;
  irreversible: boolean;
  risk: RiskScore;
  attribution: Attribution;
  status: ApprovalStatus;
  decision?: Decision;
  /**
   * Protected by keyring.yml — always requires individual approval;
   * never eligible for bulk approve.
   */
  protected?: boolean;
  protectedReason?: string;
  /** Auto-approve rule id that fired (when auto_approve.enabled). */
  autoApprovedBy?: string;
}
