/**
 * Customer policy — checked into the customer's repo as `keyring.yml`.
 * Pure types only; I/O lives in @keyring/server.
 */

export interface PolicyStalenessThresholds {
  /** Days idle before "cooling" risk bump. Default 30. */
  cooling_days: number;
  /** Days idle before "stale" risk bump. Default 90. */
  stale_days: number;
  /** Days idle before "critical" risk bump. Default 365. */
  critical_days: number;
}

export interface ProtectedResourceRule {
  /** Glob-ish match against grant.resource.id (supports * and **). */
  resource: string;
  /** Optional system filter (github, aws, …). */
  system?: string;
  reason: string;
}

export interface ServiceAccountPolicy {
  /** Stable id used as cluster seed. */
  id: string;
  display_name: string;
  /** Declared owner (email or team) — shown in attribution reasoning. */
  owner: string;
  /** Key / token ids that belong to this account (resolves orphan lookalikes). */
  key_ids?: string[];
  /** Resource ids owned by this account. */
  resource_ids?: string[];
}

export interface DeclaredAgentPolicy {
  /** Stable id used to match an agent registration. */
  id: string;
  name: string;
  runtime: string;
  /** Named human owner or responsible team. */
  owner: string;
  purpose: string;
  agent_ids?: string[];
  key_ids?: string[];
  tools?: string[];
  mcp_servers?: string[];
}

export interface AutoApproveRule {
  id: string;
  description: string;
  /** Max capability allowed (inclusive). Default: read. */
  max_capability?: "read" | "write";
  /** Require reversible revoke. Default: true. */
  reversible_only?: boolean;
  /** Optional systems allow-list. */
  systems?: string[];
  /** Max risk score to auto-approve. Default: 40. */
  max_risk?: number;
}

export interface AutoApprovePolicy {
  /** Master switch — OFF by default. */
  enabled: boolean;
  rules: AutoApproveRule[];
}

export interface ReauditPolicy {
  /** Cron expression (server-local). Empty / omit = disabled. */
  cron?: string;
  /** When true, scheduled scans only surface grant deltas vs last completed run. */
  diff_only?: boolean;
}

export interface KeyringPolicy {
  version: number;
  protected: ProtectedResourceRule[];
  service_accounts: ServiceAccountPolicy[];
  declared_agents: DeclaredAgentPolicy[];
  staleness: {
    defaults: PolicyStalenessThresholds;
    systems?: Partial<Record<string, Partial<PolicyStalenessThresholds>>>;
  };
  auto_approve: AutoApprovePolicy;
  reaudit?: ReauditPolicy;
}

export const DEFAULT_STALENESS: PolicyStalenessThresholds = {
  cooling_days: 30,
  stale_days: 90,
  critical_days: 365,
};

export const EMPTY_POLICY: KeyringPolicy = {
  version: 1,
  protected: [],
  service_accounts: [],
  declared_agents: [],
  staleness: { defaults: { ...DEFAULT_STALENESS } },
  auto_approve: { enabled: false, rules: [] },
};
