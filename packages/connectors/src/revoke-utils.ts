import { McpToolError } from "./mcp/types.js";
import type { UndoHint } from "./types.js";

/**
 * Treat "already gone" responses as success so retries are independently safe.
 */
export function isAlreadyAbsentError(error: unknown): boolean {
  const status = error instanceof McpToolError ? error.status : undefined;
  if (status === 404 || status === 410) return true;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    /\b404\b/.test(msg) ||
    /\b410\b/.test(msg) ||
    /not found/.test(msg) ||
    /does not exist/.test(msg) ||
    /no such/.test(msg) ||
    /already (removed|deleted|revoked)/.test(msg) ||
    /is not a collaborator/.test(msg) ||
    /not a (member|collaborator)/.test(msg) ||
    /membership not found/.test(msg) ||
    /permission (not found|does not exist)/.test(msg)
  );
}

export function githubCapabilityToPermission(
  capability: string,
): "pull" | "triage" | "push" | "maintain" | "admin" {
  switch (capability) {
    case "admin":
    case "owner":
      return "admin";
    case "write":
      return "push";
    default:
      return "pull";
  }
}

export function driveCapabilityToRole(capability: string): string {
  switch (capability) {
    case "owner":
      return "owner";
    case "admin":
      return "fileOrganizer";
    case "write":
      return "writer";
    default:
      return "reader";
  }
}

export function groupCapabilityToRole(capability: string): "OWNER" | "MANAGER" | "MEMBER" {
  switch (capability) {
    case "admin":
    case "owner":
      return "OWNER";
    case "write":
      return "MANAGER";
    default:
      return "MEMBER";
  }
}

export function buildUndoHint(input: {
  system: string;
  permission: string;
  restoreMethod: string;
  params: Record<string, unknown>;
}): UndoHint {
  return {
    restorable: true,
    system: input.system,
    permission: input.permission,
    restoreMethod: input.restoreMethod,
    params: input.params,
  };
}
