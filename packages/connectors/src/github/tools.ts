/** TrueForge MCP server name for GitHub (shipped catalog). */
export const GITHUB_MCP_SERVER = "github";

/** Official GitHub MCP tools we use (read-only inventory + mutating revoke). */
export const GitHubMcpTools = {
  searchRepositories: "search_repositories",
  listRepositoryCollaborators: "list_repository_collaborators",
  getTeams: "get_teams",
  getTeamMembers: "get_team_members",
  listCommits: "list_commits",
  /** Optional / custom — fixture MCP implements; live may 404-skip. */
  listDeployKeys: "list_deploy_keys",
  /** Optional — where the API exposes org PATs / fine-grained tokens. */
  listOrgPatInsights: "list_org_pat_insights",
  /** Mutating — remove a repo collaborator (idempotent on already-absent). */
  removeRepositoryCollaborator: "remove_repository_collaborator",
  /** Mutating — remove a team membership. */
  removeTeamMember: "remove_team_member",
  /** Mutating — delete a deploy key (permanent / no undo). */
  deleteDeployKey: "delete_deploy_key",
} as const;

export type GitHubPermission = "pull" | "triage" | "push" | "maintain" | "admin";

export function githubPermissionToCapability(
  permission: string | undefined,
): "read" | "write" | "admin" | "owner" {
  switch (permission) {
    case "admin":
    case "maintain":
      return "admin";
    case "push":
    case "triage":
      return "write";
    case "pull":
    default:
      return "read";
  }
}
