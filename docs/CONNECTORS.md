# Connectors

Keyring reads source systems through MCP servers configured in TrueForge. The connectors do not call Octokit, `googleapis`, or provider APIs directly. TrueForge supplies routing and credentials, and each connector converts the returned data into Keyring grants.

## Supported systems

The GitHub connector inventories repositories, teams, team members, collaborators, commit emails, pending repository invitations, deploy keys when exposed, and organization token insights when exposed. It can remove collaborators, delete pending invitations, remove team members, and delete deploy keys on the live execute path.

The Google Workspace connector inventories directory users, groups, group members, Drive shares outside the organization, and file permissions. It can delete Drive permissions and group memberships when the live execute path is enabled.

The fixture connector supplies the five systems used by the demo: AWS, GitHub, Google Workspace, Notion, and Slack. Fixtures make the scan and test suite repeatable without provider accounts.

The agent identity connector inventories readable TrueForge registrations,
automation identities, GitHub App installations, and non-human OAuth grants.
Its source contract is fixture or MCP based and every returned grant carries
evidence. An optional live adapter may implement the same contract when a
customer supplies a readable source. Unsupported provider APIs remain
explicitly unsupported. The connector is inventory-only until an underlying
source connector documents a safe mutation capability.

## MCP tools

The GitHub MCP server is registered as `github`. The connector uses `search_repositories`, `list_repository_collaborators`, `list_repository_invitations`, `get_teams`, `get_team_members`, and `list_commits`. Deploy keys and organization token insights are optional. Agent identity inventory can use a readable `trueforge` source exposing `list_agent_identities`.

The Google MCP server is registered as `google_workspace`. It must expose `list_users`, `list_groups`, `list_group_members`, `list_drive_shares_outside_org`, and `list_drive_file_permissions` for complete inventory. The revoke path uses `delete_drive_permission` and `delete_group_member`.

Pending GitHub invitations keep their strongest permission from the returned permissions object. `pull` becomes read, `push` and `triage` become write, and `maintain` and `admin` become admin.

## Failure behavior

An optional invitation, deploy key, or token tool may be absent. The connector ignores only an explicit not found response for that optional tool. Authentication errors, permission errors, rate limits, server errors, and malformed responses are returned to the scan runner. If another system succeeds, the scan is marked partial and the failure remains visible.

## Local tests

```bash
pnpm test
```

Connector contract tests use `packages/connectors/fixtures/mcp`. They make no network calls and do not require credentials.

## Live configuration

Live inventory is opt in:

```bash
LIVE_CONNECTORS=1 \
TRUEFORGE_BASE_URL=http://localhost:8791 \
GITHUB_TOKEN=your-token \
GITHUB_ORG=keyring-test \
GITHUB_MCP_URL=https://api.githubcopilot.com/mcp/ \
GOOGLE_ACCESS_TOKEN=your-token \
GOOGLE_ORG_DOMAIN=keyring-test.example \
GOOGLE_WORKSPACE_MCP_URL=https://your-google-mcp.example/mcp \
pnpm test
```

Use a throwaway organization. Live provider behavior depends on the configured MCP server and the permissions of its credentials. The repository's default tests do not verify live provider responses.
