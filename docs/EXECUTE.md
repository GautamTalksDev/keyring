# Execution and audit

Keyring separates deciding what should change from applying that change. Approving a card records intent only. A separate execute request is required before a connector can change access.

## Safe defaults

Execution is dry run by default. With `KEYRING_EXECUTE_DRY_RUN=1`, Keyring walks the full connector path, records the planned result, and makes no provider mutation. The request body can set `dryRun` to `false`, but only do that with live credentials and an intentional target.

The default revoke backend is the fixture connector. Set `KEYRING_REVOKE_BACKEND=live` only when the relevant MCP servers and write credentials are configured.

## Execution flow

1. An operator approves cards in the queue.
2. The operator starts execution for that scan.
3. Keyring skips held, protected flag only, and already successful cards.
4. For each approved executable card, Keyring writes a partial audit record before the attempt.
5. The connector runs a dry run plan or a live revoke.
6. Keyring writes the final result after the attempt.
7. The UI shows each card result and any undo information.

The API can stream `execute.card` events and an `execute.done` summary. A failed card does not become a success because another card completed.

## Restorable and permanent actions

A restorable action returns the exact permission and method needed to restore access. That undo hint is stored with the result. A permanent action has no safe restore path, such as deleting a deploy key or revoking a token.

GitHub collaborator removal, pending invitation deletion, team membership removal, Google Drive permission deletion, and group membership deletion can return restore details when the connector has enough information. Deploy keys and token revokes are permanent.

## Live setup

Start Postgres, run the migrations, start TrueForge and Keyring, then register the agent:

```bash
pnpm install
pnpm db:migrate
pnpm register:agent
```

Set the live backend and provider credentials in the environment. Approve cards in the UI, inspect the summary, and send an explicit request:

```bash
curl -s -X POST http://localhost:3001/scans/SCAN_ID/execute \
  -H 'content-type: application/json' \
  -d '{"approvedBy":"you@example.com","dryRun":false}'
```

Use a throwaway organization for live tests. The default demo never takes this path.

## Verify the ledger

```bash
curl -s http://localhost:3001/audit | jq .verification
curl -s "http://localhost:3001/audit/export?format=json" -o audit-export.json
pnpm verify:audit audit-export.json
```

The database trigger rejects updates and deletes on `audit_records`. The hash chain verifier checks the exported records without needing a database.
