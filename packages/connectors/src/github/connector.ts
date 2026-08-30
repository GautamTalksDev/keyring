import { createGrant, type Grant, type Identifier } from "@keyring/core";

import { asArray, asObject, callJson, paginatePages } from "../mcp/paginate.js";
import { McpToolError, type McpToolCaller } from "../mcp/types.js";
import type {
  Connector,
  ConnectorCapabilities,
  InventoryContext,
  RevokeContext,
  RevokeResult,
} from "../types.js";
import { GITHUB_MCP_SERVER, GitHubMcpTools, githubPermissionToCapability } from "./tools.js";
import {
  buildUndoHint,
  githubCapabilityToPermission,
  isAlreadyAbsentError,
} from "../revoke-utils.js";

export interface GitHubConnectorOptions {
  /** GitHub org login to inventory. */
  org: string;
  /** TrueForge MCP server name. Default: `github`. */
  mcpServer?: string;
  discoveredAt?: Date;
}

function requireMcp(ctx: InventoryContext | RevokeContext): McpToolCaller {
  if (!ctx.mcp) {
    throw new Error(
      "GitHubConnector requires InventoryContext.mcp (TrueForge-backed MCP tool caller)",
    );
  }
  return ctx.mcp;
}

function evidenceSource(server: string, tool: string): string {
  return `mcp:${server}/${tool}`;
}

function isTrue(value: unknown): boolean {
  return value === true || value === "true";
}

function invitationPermission(invitation: Record<string, unknown>): string {
  const explicit = invitation.role_name ?? invitation.permission;
  if (explicit !== undefined && explicit !== null && String(explicit)) {
    return String(explicit);
  }

  const permissions = asObject(invitation.permissions);
  for (const permission of ["admin", "maintain", "push", "triage", "pull"]) {
    if (isTrue(permissions[permission])) return permission;
  }
  return "pull";
}

function isUnavailableInvitationTool(error: unknown): boolean {
  if (!(error instanceof McpToolError)) return false;
  if (error.tool !== GitHubMcpTools.listRepositoryInvitations) return false;
  if (error.status !== 404) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("no mcp fixture") ||
    /(?:tool|method|operation|endpoint).*(?:not found|not available|unsupported)/.test(message) ||
    message.includes("tool is not configured")
  );
}

/**
 * GitHub inventory via TrueForge-configured GitHub MCP tools — never Octokit.
 */
export function createGitHubConnector(options: GitHubConnectorOptions): Connector {
  const server = options.mcpServer ?? GITHUB_MCP_SERVER;
  const org = options.org;
  const discoveredAt = options.discoveredAt ?? new Date();

  return {
    id: "github",
    displayName: "GitHub",

    async *inventory(ctx: InventoryContext): AsyncIterable<Grant> {
      if (ctx.credentials.kind !== "read") {
        throw new Error("inventory requires ReadCredentials (kind: 'read')");
      }
      const mcp = requireMcp(ctx);

      // Commit emails keyed by login — bridge handle → person.
      const commitEmails = new Map<string, Set<string>>();

      // --- Repos in the org ---
      const repos: Array<{ name: string; full_name?: string }> = [];
      for await (const repo of paginatePages(
        async (page) => {
          const result = await callJson(
            mcp,
            server,
            GitHubMcpTools.searchRepositories,
            { query: `org:${org}`, page, perPage: 100 },
            ctx.signal,
          );
          const body = asObject(result.data);
          const items = asArray(body, "items").map((r) => asObject(r));
          const nextPage = items.length === 100 ? page + 1 : undefined;
          return {
            items: items.map((r) => ({
              name: String(r.name ?? ""),
              full_name: r.full_name ? String(r.full_name) : undefined,
            })),
            nextPage,
          };
        },
        { signal: ctx.signal },
      )) {
        if (repo.name) repos.push(repo);
      }

      // --- Teams + memberships ---
      for await (const team of paginatePages(
        async (page) => {
          const result = await callJson(
            mcp,
            server,
            GitHubMcpTools.getTeams,
            { org, page, perPage: 100 },
            ctx.signal,
          );
          const body = asObject(result.data);
          const items = asArray(body.items !== undefined ? body : result.data, "items");
          const teams = (items.length ? items : asArray(result.data)).map(asObject);
          return {
            items: teams,
            nextPage: teams.length === 100 ? page + 1 : undefined,
          };
        },
        { signal: ctx.signal },
      )) {
        const slug = String(team.slug ?? "");
        if (!slug) continue;

        for await (const member of paginatePages(
          async (page) => {
            const result = await callJson(
              mcp,
              server,
              GitHubMcpTools.getTeamMembers,
              { org, team_slug: slug, page, perPage: 100 },
              ctx.signal,
            );
            const members = asArray(result.data).map(asObject);
            const nested = asArray(asObject(result.data), "members").map(asObject);
            const list = members.length ? members : nested;
            return {
              items: list,
              nextPage: list.length === 100 ? page + 1 : undefined,
            };
          },
          { signal: ctx.signal },
        )) {
          const login = String(member.login ?? "");
          if (!login) continue;
          const role = String(member.role ?? team.privacy ?? "member");
          yield createGrant({
            system: "github",
            principal: {
              kind: "human",
              identifiers: [{ kind: "username", value: login, source: "github" }],
            },
            resource: {
              id: `${org}/team:${slug}`,
              displayName: String(team.name ?? slug),
              kind: "other",
            },
            capability: role === "maintainer" ? "admin" : "read",
            discoveredAt,
            revocable: {
              possible: true,
              reversible: true,
              method: "teams.remove_membership",
            },
            evidence: [
              {
                claim: `Team ${slug} membership for ${login} (role=${role})`,
                source: evidenceSource(server, GitHubMcpTools.getTeamMembers),
                confidence: "certain",
                raw: { team, member },
              },
            ],
          });
        }
      }

      // --- Repo collaborators (org members + outside) + commit emails ---
      for (const repo of repos) {
        const owner = org;
        const repoName = repo.name;

        // Collect commit emails for identifier bridging
        try {
          for await (const commit of paginatePages(
            async (page) => {
              const result = await callJson(
                mcp,
                server,
                GitHubMcpTools.listCommits,
                { owner, repo: repoName, page, perPage: 30 },
                ctx.signal,
              );
              const commits = asArray(result.data).map(asObject);
              const nested = asArray(asObject(result.data), "commits").map(asObject);
              const list = commits.length ? commits : nested;
              return {
                items: list,
                nextPage: list.length === 30 ? page + 1 : undefined,
              };
            },
            { signal: ctx.signal, maxPages: 5 },
          )) {
            const authorLogin = String(
              asObject(commit.author).login ?? asObject(asObject(commit.commit).author).login ?? "",
            );
            const email = String(
              asObject(asObject(commit.commit).author).email ?? asObject(commit.commit).email ?? "",
            );
            if (authorLogin && email && !email.includes("noreply.github.com")) {
              const set = commitEmails.get(authorLogin) ?? new Set<string>();
              set.add(email.toLowerCase());
              commitEmails.set(authorLogin, set);
            }
          }
        } catch (error) {
          if (!(error instanceof McpToolError)) throw error;
        }

        for (const affiliation of ["all", "outside"] as const) {
          for await (const collab of paginatePages(
            async (page) => {
              const result = await callJson(
                mcp,
                server,
                GitHubMcpTools.listRepositoryCollaborators,
                { owner, repo: repoName, affiliation, page, perPage: 100 },
                ctx.signal,
              );
              const body = asObject(result.data);
              const list = (
                asArray(body, "collaborators").length
                  ? asArray(body, "collaborators")
                  : asArray(result.data)
              ).map(asObject);
              return {
                items: list,
                nextPage:
                  typeof body.nextPage === "number"
                    ? body.nextPage
                    : list.length === 100
                      ? page + 1
                      : undefined,
              };
            },
            { signal: ctx.signal },
          )) {
            const login = String(collab.login ?? "");
            if (!login) continue;
            // Skip duplicate "outside" pass entries already seen in "all"
            if (affiliation === "outside" && collab.permissions) {
              // still yield — outside is important; dedupe by grant id later upstream
            }
            const permission = String(
              collab.role_name ??
                (asObject(collab.permissions).admin
                  ? "admin"
                  : asObject(collab.permissions).push
                    ? "push"
                    : "pull"),
            );
            const identifiers: Identifier[] = [
              { kind: "username", value: login, source: "github" },
            ];
            for (const email of commitEmails.get(login) ?? []) {
              identifiers.push({
                kind: "commit_email",
                value: email,
                source: "github",
              });
            }

            yield createGrant({
              system: "github",
              principal: { kind: "human", identifiers },
              resource: {
                id: `${org}/${repoName}`,
                displayName: repoName,
                kind: "repo",
              },
              capability: githubPermissionToCapability(permission),
              discoveredAt,
              revocable: {
                possible: true,
                reversible: true,
                method: "remove_collaborator",
              },
              evidence: [
                {
                  claim: `GitHub collaborator ${login} has ${permission} on ${org}/${repoName} (affiliation=${affiliation})`,
                  source: evidenceSource(server, GitHubMcpTools.listRepositoryCollaborators),
                  confidence: "certain",
                  raw: collab,
                },
              ],
            });
          }
        }

        // --- Pending repository invitations ---
        // GitHub returns 201 when PUT /collaborators creates an invitation.
        // Invitations are not collaborators until accepted, so inventory them
        // separately and retain the invitation id for the correct revoke API.
        try {
          for await (const invitation of paginatePages(
            async (page) => {
              const result = await callJson(
                mcp,
                server,
                GitHubMcpTools.listRepositoryInvitations,
                { owner, repo: repoName, page, perPage: 100 },
                ctx.signal,
              );
              const body = asObject(result.data);
              const invitations = (
                asArray(body, "invitations").length
                  ? asArray(body, "invitations")
                  : asArray(body, "items").length
                    ? asArray(body, "items")
                    : asArray(result.data)
              ).map(asObject);
              return {
                items: invitations,
                nextPage:
                  typeof body.nextPage === "number"
                    ? body.nextPage
                    : invitations.length === 100
                      ? page + 1
                      : undefined,
              };
            },
            { signal: ctx.signal },
          )) {
            const invitationId = String(invitation.id ?? invitation.invitation_id ?? "");
            if (!invitationId) continue;
            const invitee = asObject(invitation.invitee);
            const login = String(invitation.login ?? invitee.login ?? "");
            const email = String(invitation.email ?? invitee.email ?? "");
            const identifiers: Identifier[] = login
              ? [{ kind: "username", value: login, source: "github" }]
              : email
                ? [{ kind: "personal_email", value: email, source: "github" }]
                : [];
            if (identifiers.length === 0) continue;
            const permission = invitationPermission(invitation);
            yield createGrant({
              system: "github",
              principal: { kind: "human", identifiers },
              resource: {
                id: `${org}/${repoName}/invitation:${invitationId}`,
                displayName: repoName,
                kind: "repo",
              },
              capability: githubPermissionToCapability(permission),
              accessState: "pending_invitation",
              discoveredAt,
              createdAt: invitation.created_at
                ? new Date(String(invitation.created_at))
                : undefined,
              revocable: {
                possible: true,
                reversible: true,
                method: "delete_repository_invitation",
              },
              evidence: [
                {
                  claim: `GitHub pending invitation for ${login || email} on ${org}/${repoName} (permission=${permission})`,
                  source: evidenceSource(server, GitHubMcpTools.listRepositoryInvitations),
                  confidence: "certain",
                  raw: invitation,
                },
              ],
            });
          }
        } catch (error) {
          // The shipped GitHub MCP may not expose invitations yet. Keep the
          // existing collaborator inventory usable when this optional tool is
          // unavailable.
          if (!isUnavailableInvitationTool(error)) throw error;
        }

        // --- Deploy keys (optional tool) ---
        try {
          const result = await callJson(
            mcp,
            server,
            GitHubMcpTools.listDeployKeys,
            { owner, repo: repoName },
            ctx.signal,
          );
          const keys = (
            asArray(asObject(result.data), "keys").length
              ? asArray(asObject(result.data), "keys")
              : asArray(result.data)
          ).map(asObject);

          for (const key of keys) {
            const keyId = String(key.id ?? key.key_id ?? key.title ?? "");
            if (!keyId) continue;
            yield createGrant({
              system: "github",
              principal: {
                kind: "unknown",
                identifiers: [
                  {
                    kind: "key_id",
                    value: String(key.id ?? key.key_id ?? keyId),
                    source: "github_deploy_keys",
                  },
                ],
              },
              resource: {
                id: `${org}/${repoName}`,
                displayName: repoName,
                kind: "repo",
              },
              capability: key.read_only === true || key.read_only === "true" ? "read" : "admin",
              discoveredAt,
              createdAt: key.created_at ? new Date(String(key.created_at)) : undefined,
              revocable: {
                possible: true,
                reversible: false,
                method: "repos.delete_deploy_key",
              },
              evidence: [
                {
                  claim: `Deploy key ${keyId} on ${org}/${repoName} (title=${String(key.title ?? "")})`,
                  source: evidenceSource(server, GitHubMcpTools.listDeployKeys),
                  confidence: "certain",
                  raw: key,
                },
              ],
            });
          }
        } catch (error) {
          if (!(error instanceof McpToolError)) throw error;
        }
      }

      // --- PATs where exposed ---
      try {
        const result = await callJson(
          mcp,
          server,
          GitHubMcpTools.listOrgPatInsights,
          { org },
          ctx.signal,
        );
        const pats = (
          asArray(asObject(result.data), "tokens").length
            ? asArray(asObject(result.data), "tokens")
            : asArray(result.data)
        ).map(asObject);
        for (const pat of pats) {
          const id = String(pat.id ?? pat.token_id ?? "");
          if (!id) continue;
          yield createGrant({
            system: "github",
            principal: {
              kind: pat.owner_login ? "human" : "unknown",
              identifiers: pat.owner_login
                ? [
                    {
                      kind: "username",
                      value: String(pat.owner_login),
                      source: "github",
                    },
                    {
                      kind: "key_id",
                      value: id,
                      source: "github_pat",
                    },
                  ]
                : [{ kind: "key_id", value: id, source: "github_pat" }],
            },
            resource: {
              id: `${org}/pat:${id}`,
              displayName: String(pat.name ?? `PAT ${id}`),
              kind: "other",
            },
            capability: "admin",
            discoveredAt,
            lastUsedAt: pat.last_used_at ? new Date(String(pat.last_used_at)) : undefined,
            revocable: {
              possible: true,
              reversible: false,
              method: "revoke_pat",
            },
            evidence: [
              {
                claim: `Org PAT insight ${id} (owner=${String(pat.owner_login ?? "none")})`,
                source: evidenceSource(server, GitHubMcpTools.listOrgPatInsights),
                confidence: "probable",
                raw: pat,
              },
            ],
          });
        }
      } catch (error) {
        if (!(error instanceof McpToolError)) throw error;
      }
    },

    async revoke(grant: Grant, ctx: RevokeContext): Promise<RevokeResult> {
      if (ctx.credentials.kind !== "write") {
        throw new Error("revoke requires WriteCredentials (kind: 'write')");
      }
      if (grant.system !== "github") {
        return { ok: false, error: "not a github grant" };
      }

      const login = grant.principal.identifiers.find(
        (i: Identifier) => i.kind === "username",
      )?.value;
      const resourceId = String(grant.resource.id);
      const teamMatch = resourceId.match(/^([^/]+)\/team:(.+)$/);
      const patMatch = resourceId.match(/^([^/]+)\/pat:(.+)$/);
      const deployKeyId = grant.principal.identifiers.find(
        (i: Identifier) => i.kind === "key_id" && i.source === "github_deploy_keys",
      )?.value;

      // --- Team membership ---
      if (teamMatch) {
        const [, teamOrg, teamSlug] = teamMatch;
        if (!login || !teamOrg || !teamSlug) {
          return { ok: false, error: "team revoke requires username + org/team slug" };
        }
        const permission = String(grant.capability === "admin" ? "maintainer" : "member");
        const undoHint = buildUndoHint({
          system: "github",
          permission,
          restoreMethod: "add_team_member",
          params: {
            org: teamOrg,
            team_slug: teamSlug,
            username: login,
            role: permission,
          },
        });
        if (ctx.dryRun) {
          return {
            ok: true,
            detail: `dry_run: would remove ${login} from team ${teamOrg}/${teamSlug}`,
            undoHint,
          };
        }
        const mcp = requireMcp(ctx);
        try {
          await callJson(
            mcp,
            server,
            GitHubMcpTools.removeTeamMember,
            { org: teamOrg, team_slug: teamSlug, username: login },
            ctx.signal,
          );
          return {
            ok: true,
            detail: `removed ${login} from team ${teamOrg}/${teamSlug} (approval ${ctx.approvalCardId})`,
            undoHint,
          };
        } catch (error) {
          if (isAlreadyAbsentError(error)) {
            return {
              ok: true,
              alreadyAbsent: true,
              detail: `already absent: ${login} not on team ${teamOrg}/${teamSlug}`,
              undoHint,
            };
          }
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      // --- PAT insights (permanent) ---
      if (patMatch) {
        return {
          ok: false,
          error:
            "PAT revoke is not supported via MCP — revoke the token in GitHub settings (permanent)",
        };
      }

      // --- Pending repository invitation ---
      const invitationMatch = resourceId.match(/^([^/]+)\/([^/]+)\/invitation:(.+)$/);
      if (
        invitationMatch ||
        grant.accessState === "pending_invitation" ||
        grant.revocable.method === "delete_repository_invitation"
      ) {
        const [, invitationOwner, invitationRepo, invitationId] = invitationMatch ?? [];
        if (!invitationOwner || !invitationRepo || !invitationId) {
          return {
            ok: false,
            error: "invitation revoke requires owner/repo/invitation resource id",
          };
        }
        const permission = githubCapabilityToPermission(grant.capability);
        const undoHint = buildUndoHint({
          system: "github",
          permission,
          restoreMethod: "add_repository_collaborator",
          params: {
            owner: invitationOwner,
            repo: invitationRepo,
            username: login,
            permission,
          },
        });
        if (ctx.dryRun) {
          return {
            ok: true,
            detail: `dry_run: would delete pending invitation ${invitationId} from ${invitationOwner}/${invitationRepo}`,
            undoHint,
          };
        }
        const mcp = requireMcp(ctx);
        try {
          await callJson(
            mcp,
            server,
            GitHubMcpTools.deleteRepositoryInvitation,
            {
              owner: invitationOwner,
              repo: invitationRepo,
              invitation_id: invitationId,
            },
            ctx.signal,
          );
          return {
            ok: true,
            detail: `deleted pending invitation ${invitationId} from ${invitationOwner}/${invitationRepo} (approval ${ctx.approvalCardId})`,
            undoHint,
          };
        } catch (error) {
          if (isAlreadyAbsentError(error)) {
            return {
              ok: true,
              alreadyAbsent: true,
              detail: `already absent: invitation ${invitationId} on ${invitationOwner}/${invitationRepo}`,
              undoHint,
            };
          }
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      // --- Deploy key (permanent) ---
      if (deployKeyId || grant.revocable.method === "repos.delete_deploy_key") {
        const [owner, repo] = resourceId.split("/");
        if (!owner || !repo || !deployKeyId) {
          return { ok: false, error: "deploy key revoke requires owner/repo + key id" };
        }
        if (ctx.dryRun) {
          return {
            ok: true,
            detail: `dry_run: would delete deploy key ${deployKeyId} on ${owner}/${repo} (permanent)`,
          };
        }
        const mcp = requireMcp(ctx);
        try {
          await callJson(
            mcp,
            server,
            GitHubMcpTools.deleteDeployKey,
            { owner, repo, key_id: deployKeyId },
            ctx.signal,
          );
          return {
            ok: true,
            detail: `deleted deploy key ${deployKeyId} on ${owner}/${repo} (permanent; approval ${ctx.approvalCardId})`,
          };
        } catch (error) {
          if (isAlreadyAbsentError(error)) {
            return {
              ok: true,
              alreadyAbsent: true,
              detail: `already absent: deploy key ${deployKeyId}`,
            };
          }
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      // --- Repo collaborator ---
      const [owner, repo] = resourceId.split("/");
      if (!login || !owner || !repo || repo.startsWith("team:") || repo.startsWith("pat:")) {
        return {
          ok: false,
          error: "revoke via MCP only supported for repo collaborators and team memberships",
        };
      }
      const permission = githubCapabilityToPermission(grant.capability);
      const undoHint = buildUndoHint({
        system: "github",
        permission,
        restoreMethod: "add_repository_collaborator",
        params: { owner, repo, username: login, permission },
      });
      if (ctx.dryRun) {
        return {
          ok: true,
          detail: `dry_run: would remove ${login} (${permission}) from ${owner}/${repo}`,
          undoHint,
        };
      }
      const mcp = requireMcp(ctx);
      try {
        await callJson(
          mcp,
          server,
          GitHubMcpTools.removeRepositoryCollaborator,
          { owner, repo, username: login },
          ctx.signal,
        );
        return {
          ok: true,
          detail: `removed ${login} (${permission}) from ${owner}/${repo} (approval ${ctx.approvalCardId})`,
          undoHint,
        };
      } catch (error) {
        if (isAlreadyAbsentError(error)) {
          return {
            ok: true,
            alreadyAbsent: true,
            detail: `already absent: ${login} not a collaborator on ${owner}/${repo}`,
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
        reportsLastUsed: false,
      };
    },
  };
}
