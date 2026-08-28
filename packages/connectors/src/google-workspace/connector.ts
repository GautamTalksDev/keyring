import { createGrant, type Grant } from "@keyring/core";

import { asArray, asObject, callJson, paginateTokens } from "../mcp/paginate.js";
import { McpToolError, type McpToolCaller } from "../mcp/types.js";
import type {
  Connector,
  ConnectorCapabilities,
  InventoryContext,
  RevokeContext,
  RevokeResult,
} from "../types.js";
import {
  GOOGLE_WORKSPACE_MCP_SERVER,
  GoogleWorkspaceMcpTools,
  driveRoleToCapability,
} from "./tools.js";
import {
  buildUndoHint,
  driveCapabilityToRole,
  groupCapabilityToRole,
  isAlreadyAbsentError,
} from "../revoke-utils.js";

export interface GoogleWorkspaceConnectorOptions {
  /** Primary org domain, e.g. `keyring-test.example`. */
  orgDomain: string;
  mcpServer?: string;
  discoveredAt?: Date;
}

function requireMcp(ctx: InventoryContext | RevokeContext): McpToolCaller {
  if (!ctx.mcp) {
    throw new Error(
      "GoogleWorkspaceConnector requires InventoryContext.mcp (TrueForge-backed MCP tool caller)",
    );
  }
  return ctx.mcp;
}

function evidenceSource(server: string, tool: string): string {
  return `mcp:${server}/${tool}`;
}

function isOutsideOrgEmail(email: string, orgDomain: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  return email.slice(at + 1).toLowerCase() !== orgDomain.toLowerCase();
}

function extractDrivePermissionId(grant: Grant): string | undefined {
  for (const ev of grant.evidence) {
    const raw = ev.raw;
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const perm = obj.perm ?? obj.permission ?? obj.share;
    if (perm && typeof perm === "object") {
      const id = (perm as Record<string, unknown>).id;
      if (typeof id === "string" && id.length > 0) return id;
    }
    if (typeof obj.permissionId === "string" && obj.permissionId.length > 0) {
      return obj.permissionId;
    }
  }
  return undefined;
}

/**
 * Google Workspace inventory via TrueForge-configured MCP tools — never googleapis SDK.
 */
export function createGoogleWorkspaceConnector(
  options: GoogleWorkspaceConnectorOptions,
): Connector {
  const server = options.mcpServer ?? GOOGLE_WORKSPACE_MCP_SERVER;
  const orgDomain = options.orgDomain;
  const discoveredAt = options.discoveredAt ?? new Date();

  return {
    id: "google_workspace",
    displayName: "Google Workspace",

    async *inventory(ctx: InventoryContext): AsyncIterable<Grant> {
      if (ctx.credentials.kind !== "read") {
        throw new Error("inventory requires ReadCredentials (kind: 'read')");
      }
      const mcp = requireMcp(ctx);

      // --- Users (directory) as identity anchors / group-ready principals ---
      for await (const user of paginateTokens(
        async (pageToken) => {
          const result = await callJson(
            mcp,
            server,
            GoogleWorkspaceMcpTools.listUsers,
            { domain: orgDomain, pageToken, maxResults: 100 },
            ctx.signal,
          );
          const body = asObject(result.data);
          const users = asArray(body, "users").map(asObject);
          return {
            items: users,
            nextPageToken: body.nextPageToken
              ? String(body.nextPageToken)
              : undefined,
          };
        },
        { signal: ctx.signal },
      )) {
        // Users alone are not grants — group memberships and Drive shares are.
        void user;
      }

      // --- Group memberships ---
      for await (const group of paginateTokens(
        async (pageToken) => {
          const result = await callJson(
            mcp,
            server,
            GoogleWorkspaceMcpTools.listGroups,
            { domain: orgDomain, pageToken },
            ctx.signal,
          );
          const body = asObject(result.data);
          const groups = asArray(body, "groups").map(asObject);
          return {
            items: groups,
            nextPageToken: body.nextPageToken
              ? String(body.nextPageToken)
              : undefined,
          };
        },
        { signal: ctx.signal },
      )) {
        const groupKey = String(group.email ?? group.id ?? "");
        if (!groupKey) continue;

        for await (const member of paginateTokens(
          async (pageToken) => {
            const result = await callJson(
              mcp,
              server,
              GoogleWorkspaceMcpTools.listGroupMembers,
              { groupKey, pageToken },
              ctx.signal,
            );
            const body = asObject(result.data);
            const members = asArray(body, "members").map(asObject);
            return {
              items: members,
              nextPageToken: body.nextPageToken
                ? String(body.nextPageToken)
                : undefined,
            };
          },
          { signal: ctx.signal },
        )) {
          const email = String(member.email ?? "");
          if (!email) continue;
          const role = String(member.role ?? "MEMBER").toUpperCase();
          yield createGrant({
            system: "google_workspace",
            principal: {
              kind: "human",
              identifiers: [
                {
                  kind: isOutsideOrgEmail(email, orgDomain)
                    ? "personal_email"
                    : "work_email",
                  value: email,
                  source: "google_workspace",
                },
              ],
            },
            resource: {
              id: `groups/${groupKey}`,
              displayName: String(group.name ?? groupKey),
              kind: "other",
            },
            capability: role === "OWNER" || role === "MANAGER" ? "admin" : "read",
            discoveredAt,
            revocable: {
              possible: true,
              reversible: true,
              method: "directory.members.delete",
            },
            evidence: [
              {
                claim: `Group ${groupKey} membership for ${email} (role=${role})`,
                source: evidenceSource(server, GoogleWorkspaceMcpTools.listGroupMembers),
                confidence: "certain",
                raw: { group, member },
              },
            ],
          });
        }
      }

      // --- Drive files shared outside the org (scary ones) ---
      for await (const share of paginateTokens(
        async (pageToken) => {
          const result = await callJson(
            mcp,
            server,
            GoogleWorkspaceMcpTools.listDriveSharesOutsideOrg,
            { orgDomain, pageToken },
            ctx.signal,
          );
          const body = asObject(result.data);
          const shares = asArray(body, "shares").map(asObject);
          return {
            items: shares,
            nextPageToken: body.nextPageToken
              ? String(body.nextPageToken)
              : undefined,
          };
        },
        { signal: ctx.signal },
      )) {
        const fileId = String(share.fileId ?? share.id ?? "");
        const email = String(share.emailAddress ?? share.email ?? "");
        if (!fileId || !email) continue;

        // Enrich with per-file permissions when available
        let permissionRaw: unknown = share;
        try {
          const perms = await callJson(
            mcp,
            server,
            GoogleWorkspaceMcpTools.listDriveFilePermissions,
            { fileId },
            ctx.signal,
          );
          permissionRaw = perms.data;
        } catch (error) {
          if (!(error instanceof McpToolError)) throw error;
        }

        const role = String(share.role ?? "reader");
        const folderId = fileId.startsWith("folders/") ? fileId : `folders/${fileId}`;

        yield createGrant({
          system: "google_workspace",
          principal: {
            kind: "human",
            identifiers: [
              {
                kind: "personal_email",
                value: email,
                source: "google_workspace",
              },
            ],
          },
          resource: {
            id: folderId,
            displayName: String(share.fileName ?? share.name ?? folderId),
            kind: "drive_folder",
          },
          capability: driveRoleToCapability(role),
          discoveredAt,
          lastUsedAt: share.viewedByMeTime
            ? new Date(String(share.viewedByMeTime))
            : share.modifiedTime
              ? new Date(String(share.modifiedTime))
              : undefined,
          createdAt: share.createdTime
            ? new Date(String(share.createdTime))
            : undefined,
          revocable: {
            possible: true,
            reversible: true,
            method: "drive.permissions.delete",
          },
          evidence: [
            {
              claim: `Drive file ${folderId} shared outside org domain ${orgDomain} to ${email} (role=${role})`,
              source: evidenceSource(
                server,
                GoogleWorkspaceMcpTools.listDriveSharesOutsideOrg,
              ),
              confidence: "certain",
              raw: { share, permissions: permissionRaw },
            },
          ],
        });
      }

      // --- In-org Drive ACLs (work email grants) via file permissions listing on known shares ---
      // Fixture MCP also returns in-domain permissions through list_drive_file_permissions
      // for folders owned inside the org.
      try {
        const catalog = await callJson(
          mcp,
          server,
          GoogleWorkspaceMcpTools.listDriveFilePermissions,
          { fileId: "__inventory_roots__" },
          ctx.signal,
        );
        const roots = asArray(asObject(catalog.data), "files").map(asObject);
        for (const file of roots) {
          const fileId = String(file.id ?? "");
          if (!fileId) continue;
          const permsResult = await callJson(
            mcp,
            server,
            GoogleWorkspaceMcpTools.listDriveFilePermissions,
            { fileId },
            ctx.signal,
          );
          const perms = asArray(asObject(permsResult.data), "permissions").map(asObject);
          for (const perm of perms) {
            const email = String(perm.emailAddress ?? "");
            if (!email) continue;
            if (isOutsideOrgEmail(email, orgDomain)) continue; // already covered
            const role = String(perm.role ?? "reader");
            const folderId = fileId.startsWith("folders/")
              ? fileId
              : `folders/${fileId}`;
            yield createGrant({
              system: "google_workspace",
              principal: {
                kind: "human",
                identifiers: [
                  {
                    kind: "work_email",
                    value: email,
                    source: "google_workspace",
                  },
                ],
              },
              resource: {
                id: folderId,
                displayName: String(file.name ?? folderId),
                kind: "drive_folder",
              },
              capability: driveRoleToCapability(role),
              discoveredAt,
              lastUsedAt: file.viewedByMeTime
                ? new Date(String(file.viewedByMeTime))
                : undefined,
              createdAt: file.createdTime
                ? new Date(String(file.createdTime))
                : undefined,
              revocable: {
                possible: true,
                reversible: role !== "owner",
                method:
                  role === "owner"
                    ? "transfer_ownership_then_remove"
                    : "drive.permissions.delete",
              },
              evidence: [
                {
                  claim: `Drive ACL lists ${email} as ${role} on ${folderId}`,
                  source: evidenceSource(
                    server,
                    GoogleWorkspaceMcpTools.listDriveFilePermissions,
                  ),
                  confidence: "certain",
                  raw: { file, perm },
                },
              ],
            });
          }
        }
      } catch (error) {
        if (!(error instanceof McpToolError)) throw error;
      }
    },

    async revoke(grant: Grant, ctx: RevokeContext): Promise<RevokeResult> {
      if (ctx.credentials.kind !== "write") {
        throw new Error("revoke requires WriteCredentials (kind: 'write')");
      }
      if (grant.system !== "google_workspace") {
        return { ok: false, error: "not a google_workspace grant" };
      }
      const email = grant.principal.identifiers.find(
        (i) => i.kind === "work_email" || i.kind === "personal_email",
      )?.value;
      if (!email) return { ok: false, error: "missing email identifier" };

      // --- Group membership ---
      if (
        grant.resource.id.startsWith("groups/") ||
        grant.revocable.method === "directory.members.delete"
      ) {
        const groupKey = grant.resource.id.replace(/^groups\//, "");
        if (!groupKey) return { ok: false, error: "missing group key" };
        const role = groupCapabilityToRole(grant.capability);
        const undoHint = buildUndoHint({
          system: "google_workspace",
          permission: role,
          restoreMethod: "directory.members.insert",
          params: { groupKey, email, role },
        });
        if (ctx.dryRun) {
          return {
            ok: true,
            detail: `dry_run: would remove ${email} (${role}) from group ${groupKey}`,
            undoHint,
          };
        }
        const mcp = requireMcp(ctx);
        try {
          await callJson(
            mcp,
            server,
            GoogleWorkspaceMcpTools.deleteGroupMember,
            { groupKey, memberKey: email },
            ctx.signal,
          );
          return {
            ok: true,
            detail: `removed ${email} (${role}) from group ${groupKey} (approval ${ctx.approvalCardId})`,
            undoHint,
          };
        } catch (error) {
          if (isAlreadyAbsentError(error)) {
            return {
              ok: true,
              alreadyAbsent: true,
              detail: `already absent: ${email} not in group ${groupKey}`,
              undoHint,
            };
          }
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      // --- Drive ACL ---
      if (grant.revocable.method === "transfer_ownership_then_remove") {
        return {
          ok: false,
          error:
            "owner Drive ACLs require transfer_ownership before revoke — not auto-executed",
        };
      }

      const fileId = grant.resource.id.replace(/^folders\//, "");
      const role = driveCapabilityToRole(grant.capability);
      const permissionId = extractDrivePermissionId(grant);
      const undoHint = buildUndoHint({
        system: "google_workspace",
        permission: role,
        restoreMethod: "drive.permissions.create",
        params: {
          fileId,
          email,
          role,
          type: "user",
          ...(permissionId ? { previousPermissionId: permissionId } : {}),
        },
      });
      if (ctx.dryRun) {
        return {
          ok: true,
          detail: `dry_run: would remove ${email} (${role}) from Drive ${fileId}`,
          undoHint,
        };
      }
      const mcp = requireMcp(ctx);
      try {
        await callJson(
          mcp,
          server,
          GoogleWorkspaceMcpTools.deleteDrivePermission,
          {
            fileId,
            email,
            ...(permissionId ? { permissionId } : {}),
          },
          ctx.signal,
        );
        return {
          ok: true,
          detail: `removed ${email} (${role}) from Drive ${fileId} (approval ${ctx.approvalCardId})`,
          undoHint,
        };
      } catch (error) {
        if (isAlreadyAbsentError(error)) {
          return {
            ok: true,
            alreadyAbsent: true,
            detail: `already absent: ${email} has no permission on ${fileId}`,
            undoHint,
          };
        }
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    capabilities(): ConnectorCapabilities {
      return {
        canRevoke: true,
        canDowngrade: false,
        reportsLastUsed: true,
      };
    },
  };
}
