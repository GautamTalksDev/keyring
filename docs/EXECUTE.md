# Execution + audit ledger

Real revocation for GitHub and Google Workspace, gated behind harness / product approval. Dry-run is **on by default**.

## Safety defaults

| Knob                      | Default     | Meaning                                                                           |
| ------------------------- | ----------- | --------------------------------------------------------------------------------- |
| `KEYRING_EXECUTE_DRY_RUN` | `1` (ON)    | Walk the full execute path; write before/after AuditRecords; **no mutating APIs** |
| `KEYRING_REVOKE_BACKEND`  | `fixture`   | Use FixtureConnector + fixture MCP. Set `live` for GitHub/Google MCP              |
| Body `dryRun`             | follows env | `POST /scans/:id/execute` `{ dryRun: false }` required for live mutation          |

A judge cloning the repo cannot revoke their own access without deliberately disabling dry-run.

## Start the live path from a clean machine

Install dependencies and start the database before starting Keyring:

```bash
pnpm install
cp .env.example .env
cd infra && docker compose up keyring-db -d
cd ..
export DATABASE_URL=postgresql://keyring:keyring@localhost:5432/keyring
pnpm db:migrate
```

If no paid model provider is configured, start the zero-cost local model in a
separate terminal and keep the stub flag set for registration:

```bash
KEYRING_ALLOW_STUB=1 pnpm stub:model
```

In another terminal, start the API:

```bash
export TRUEFORGE_BASE_URL=http://localhost:8791
export KEYRING_ALLOW_STUB=1
pnpm --filter @keyring/server dev
```

In a third terminal, start the UI:

```bash
pnpm --filter @keyring/web dev
```

After the API and TrueForge are reachable, register the agent:

```bash
pnpm register:agent
```

`pnpm register:agent` verifies that `keyring` appears in
`GET /api/v1/agents`; a non-2xx response or a missing agent is a failed setup,
not a successful registration. With `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`,
use that provider instead and omit the stub command and
`KEYRING_ALLOW_STUB=1`.

## Flow

1. Human **approves** cards (intent only — no revoke).
2. Human runs **execute** (UI defaults to dry-run checkbox on).
3. For each approved, executable card:
   - Skip CI-trap / `flag_only` / already-succeeded executes (independent retry).
   - Append AuditRecord `result: partial` **before** the attempt.
   - Call connector `revoke` (or dry-run plan) — GitHub/Google when `KEYRING_REVOKE_BACKEND=live`.
   - Append AuditRecord with outcome **after** (`success` / `failed` / `partial`+`dry_run`).
4. Partial failure across N grants never invents success: each card’s ledger stands alone.

## Undo hints → Restorable vs Permanent

When a system supports restore, the connector returns an `undoHint` (exact permission removed + restore method + params). It is written into the after-audit `evidenceSnapshot`.

| Badge          | Meaning                                                    |
| -------------- | ---------------------------------------------------------- |
| **Restorable** | `revocable.reversible` — undo hint captured when available |
| **Permanent**  | irreversible (PAT, deploy key, …)                          |

## Live offboard (test org)

```bash
export KEYRING_EXECUTE_DRY_RUN=0
export KEYRING_REVOKE_BACKEND=live
export GITHUB_TOKEN=…
export GITHUB_ORG=keyring-test
export GITHUB_MCP_URL=https://api.githubcopilot.com/mcp/
export GOOGLE_ACCESS_TOKEN=…
export GOOGLE_ORG_DOMAIN=…
export GOOGLE_WORKSPACE_MCP_URL=…

# Approve cards in the UI, then:
curl -s -X POST localhost:3001/scans/$SCAN/execute \
  -H 'content-type: application/json' \
  -d '{"approvedBy":"you@example.com","dryRun":false}'

curl -s localhost:3001/audit/export?format=json -o audit-export.json
pnpm verify:audit audit-export.json
```

Harness path: TrueForge must require approval for `keyring-mutate` / `revoke_grant` (see `agents/keyring.agent.json`).

## Verify export

```bash
pnpm verify:audit path/to/audit-export.json
```

Uses `@keyring/core` `parseAuditExport` + `verifyAuditChain` — no database required.

Fixture dry-run → live ledger demo (no live MCP):

```bash
pnpm exec tsx scripts/demo-offboard-audit.ts
pnpm verify:audit fixtures/audit-export-demo.json
```
