# MCP connectors (GitHub + Google Workspace)

Keyring inventories **through TrueForge-configured MCP servers**, not through Octokit / `googleapis`. The harness owns tool credentials and routing; connectors only call `ctx.mcp.callTool({ server, tool, arguments })`.

## Servers

| TrueForge name | Catalog / setup | Purpose |
| --- | --- | --- |
| `github` | Shipped catalog → [https://api.githubcopilot.com/mcp/](https://api.githubcopilot.com/mcp/) (header auth PAT) | Org repos, collaborators, teams, commits (emails), optional deploy keys / PAT insights |
| `google_workspace` | **Custom** remote MCP URL in Settings → Connectors | Directory users/groups + Drive shares outside the org |

Register both under **TrueForge → Settings → Connectors** before live inventory. See [MCP servers](https://trueforge.dev/mcp-servers).

### Google Workspace tool contract

Your Google MCP must expose (names matter):

- `list_users`
- `list_groups`
- `list_group_members`
- `list_drive_shares_outside_org` — **required for personal-Gmail shares**
- `list_drive_file_permissions`
- `delete_drive_permission` (revoke path — restorable)
- `delete_group_member` (group membership revoke — restorable)

### GitHub tools used

From the official GitHub MCP: `search_repositories`, `list_repository_collaborators`, `get_teams`, `get_team_members`, `list_commits`.

Mutating (execute path): `remove_repository_collaborator`, `remove_team_member`, optional `delete_deploy_key` (permanent).

Optional inventory (fixture MCP implements; live skips if missing): `list_deploy_keys`, `list_org_pat_insights`.

## Revoke + dry-run

See [EXECUTE.md](./EXECUTE.md). Product execute and MCP `revoke_grant` route through the same connectors. `KEYRING_REVOKE_BACKEND=live` + MCP URLs required for real GitHub/Google mutations. Dry-run default prevents accidental revoke.
## Local / CI (fixtures)

```bash
pnpm test
```

Contract tests use `createFixtureMcpToolCaller()` → `packages/connectors/fixtures/mcp/**`. No network.

## Live (opt-in)

```bash
LIVE_CONNECTORS=1 \
TRUEFORGE_BASE_URL=http://localhost:8791 \
GITHUB_TOKEN=... \
GITHUB_ORG=keyring-test \
GITHUB_MCP_URL=https://api.githubcopilot.com/mcp/ \
GOOGLE_ACCESS_TOKEN=... \
GOOGLE_ORG_DOMAIN=keyring-test.example \
GOOGLE_WORKSPACE_MCP_URL=https://your-google-mcp.example/mcp \
pnpm test
```

Skipped unless `LIVE_CONNECTORS=1`.
