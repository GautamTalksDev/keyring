/**
 * Sandbox-friendly identity reconciliation entrypoints.
 * Pure clustering lives in reconcile.ts; this module only shapes I/O payloads.
 */

export type {
  ClusterKind,
  DirectoryEntry,
  IdentityCluster,
  KeyAttribution,
  ReconciliationInput,
  ReconciliationResult,
  ServiceAccountDeclaration,
  SignalKind,
  UnknownBucket,
} from "./types.js";
export {
  reconcileIdentities,
  serializeReconciliationResult,
} from "./reconcile.js";
export {
  USERNAME_SIMILARITY_THRESHOLD,
  usernameNameSimilarity,
} from "./similarity.js";
export { runReconciliationFromJson } from "./run.js";
export { CI_TRAP_MARKER } from "./trap.js";
