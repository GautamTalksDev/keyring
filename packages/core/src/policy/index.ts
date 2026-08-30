export type {
  AutoApprovePolicy,
  AutoApproveRule,
  DeclaredAgentPolicy,
  KeyringPolicy,
  PolicyStalenessThresholds,
  ProtectedResourceRule,
  ReauditPolicy,
  ServiceAccountPolicy,
} from "./types.js";
export { DEFAULT_STALENESS, EMPTY_POLICY } from "./types.js";
export {
  findAutoApproveRule,
  findProtectedRule,
  keyAttributionsFromPolicy,
  matchResourcePattern,
  normalizePolicy,
  resolveStaleness,
  declaredAgentsFromPolicy,
  serviceAccountsFromPolicy,
} from "./apply.js";
