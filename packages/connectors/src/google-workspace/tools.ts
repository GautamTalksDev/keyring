/** TrueForge MCP server name for Google Workspace (custom connector URL). */
export const GOOGLE_WORKSPACE_MCP_SERVER = "google_workspace";

export const GoogleWorkspaceMcpTools = {
  listUsers: "list_users",
  listGroups: "list_groups",
  listGroupMembers: "list_group_members",
  listDriveSharesOutsideOrg: "list_drive_shares_outside_org",
  listDriveFilePermissions: "list_drive_file_permissions",
  /** Mutating — remove a Drive ACL entry (restorable via create). */
  deleteDrivePermission: "delete_drive_permission",
  /** Mutating — remove a group member (restorable via insert). */
  deleteGroupMember: "delete_group_member",
} as const;

export function driveRoleToCapability(
  role: string | undefined,
): "read" | "write" | "admin" | "owner" {
  switch ((role ?? "").toLowerCase()) {
    case "owner":
      return "owner";
    case "organizer":
    case "fileorganizer":
    case "writer":
      return "write";
    case "commenter":
    case "reader":
    default:
      return "read";
  }
}
