# Server HTTP API

Product API the UI consumes. The **agent loop** stays in TrueForge (`@truefoundry/trueforge-sdk`); this server persists grants, ApprovalCards, and the audit ledger.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/scans` | Start scan (`person` or `scope`) → `{ scanId }` |
| `GET` | `/scans/:id/stream` | SSE: subagent progress, reconcile, completion |
| `GET` | `/scans/:id/cards` | Approval queue for the scan |
| `POST` | `/cards/:id/decision` | `{ decision: approve\|hold\|reject, note?, by? }` — **intent only** |
| `POST` | `/scans/:id/execute` | Execute approved cards (SSE if `Accept: text/event-stream`) |
| `GET` | `/audit` | Ledger + hash-chain verification |
| `GET` | `/audit/export` | Signed JSON or CSV (`?format=json\|csv`) |

## Rules

- **Decision ≠ execute.** Approving a card never revokes. Execution is a separate `POST /scans/:id/execute`.
- Every mutation writes an **AuditRecord before and after** the attempt (`result: partial` then `success`/`failed`).
- **Dry-run defaults ON** (`KEYRING_EXECUTE_DRY_RUN=1` or body `dryRun` omitted/true). Pass `"dryRun": false` to mutate for real. See [EXECUTE.md](./EXECUTE.md).
- Zod validation on every input. Logs include `scanId` on scan-scoped work.

## Drivers

| `KEYRING_SCAN_DRIVER` / body `driver` | Behavior |
| --- | --- |
| `fixture` (default) | Fan-out via FixtureConnector; emits subagent SSE events locally |
| `trueforge` | Opens a TrueForge session/turn with the SDK, mirrors harness events, then persists a durable fixture snapshot |

## curl (fixture)

```bash
export DATABASE_URL=postgresql://keyring:keyring@localhost:5432/keyring
pnpm db:migrate
pnpm --filter @keyring/server start

SCAN=$(curl -s -X POST http://localhost:3001/scans \
  -H 'content-type: application/json' \
  -d '{"person":"Ada Lovelace","driver":"fixture"}' | jq -r .scanId)

curl -N "http://localhost:3001/scans/$SCAN/stream"
curl -s "http://localhost:3001/scans/$SCAN/cards" | jq .

CARD=$(curl -s "http://localhost:3001/scans/$SCAN/cards" | jq -r '.cards[] | select(.proposedAction.kind=="revoke" and .status=="pending") | .id' | head -1)
curl -s -X POST "http://localhost:3001/cards/$CARD/decision" \
  -H 'content-type: application/json' \
  -d '{"decision":"approve","by":"you@example.com","note":"intent only"}'

# Dry-run (default) — no mutating APIs
curl -s -X POST "http://localhost:3001/scans/$SCAN/execute" \
  -H 'content-type: application/json' \
  -d '{"approvedBy":"you@example.com"}' | jq .

# Live execute (explicit)
curl -s -X POST "http://localhost:3001/scans/$SCAN/execute" \
  -H 'content-type: application/json' \
  -d '{"approvedBy":"you@example.com","dryRun":false}' | jq .

curl -s http://localhost:3001/audit | jq .verification
curl -s "http://localhost:3001/audit/export?format=json" -o audit-export.json
pnpm verify:audit audit-export.json
```

`verification.ok === true` (and `pnpm verify:audit`) means the ledger hash chain is intact.