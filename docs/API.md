# Keyring HTTP API

The Keyring server provides the API used by the web UI. It stores grants, ApprovalCards, scan state, execution results, and the audit ledger. TrueForge owns the agent loop and its own session API.

## Endpoints

- `POST /scans` starts a scan. Supply `person`, `scope`, or both. The response contains `scanId`.
- `GET /scans/:id` returns scan status, metadata, identity counts, and costs.
- `GET /scans/:id/stream` sends scan progress as server sent events.
- `GET /scans/:id/cards` returns the ApprovalCards for a scan.
- `POST /cards/:id/decision` records `approve`, `hold`, or `reject`. This records intent and never executes a provider action.
- `POST /scans/:id/execute` executes approved cards. An event stream is returned when the request accepts `text/event-stream`.
- `GET /audit` returns ledger records and hash verification.
- `GET /audit/export` returns a signed JSON or CSV export.
- `GET /recordings` lists available local recordings.
- `POST /scans/:id/demo-reset` resets card decisions for an aborted demo take. It is available only when `KEYRING_DEMO=1`; append-only audit records are retained.

## Scan drivers

The `driver` field or `KEYRING_SCAN_DRIVER` selects the scan implementation:

- `fixture` runs local fixture connectors and emits local subagent events.
- `trueforge` starts a TrueForge session and mirrors its events.
- `record` runs a scan and stores its tool summaries, events, costs, and cards.
- `replay` reads a recording and makes no provider calls.

The scan metadata and `/scans/:id/cards` response expose `cardCount`,
`humanIdentityCount`, `agentIdentityCount`, and `systemCount`. Agent cards
include their runtime, purpose, reachable tools, declaration status, and
evidence in the serialized grant principal. The fixture and replay drivers
keep the authoritative demo queue at nine cards or fewer, retaining agent,
protected, and held findings before lower-risk findings.

## Decisions and execution

Approval is separate from execution. A decision changes the card state and writes an audit record. Execution selects approved cards, writes a before record, calls the connector or dry run plan, then writes the result. Protected cards cannot be approved in bulk.

Dry run is enabled by default. Set `dryRun` to `false` in the execute request only when live mutation is intentional and the live backend is configured.

## Example

Start a fixture scan:

```bash
SCAN=$(curl -s -X POST http://localhost:3001/scans \
  -H 'content-type: application/json' \
  -d '{"person":"Ada Lovelace","driver":"fixture"}' | jq -r .scanId)
```

Read progress and cards:

```bash
curl -N "http://localhost:3001/scans/$SCAN/stream"
curl -s "http://localhost:3001/scans/$SCAN/cards" | jq .
```

Record an approval and execute it as a dry run:

```bash
CARD=$(curl -s "http://localhost:3001/scans/$SCAN/cards" | jq -r '.cards[] | select(.status=="pending") | .id' | head -1)
curl -s -X POST "http://localhost:3001/cards/$CARD/decision" \
  -H 'content-type: application/json' \
  -d '{"decision":"approve","by":"you@example.com"}'

curl -s -X POST "http://localhost:3001/scans/$SCAN/execute" \
  -H 'content-type: application/json' \
  -d '{"approvedBy":"you@example.com"}' | jq .
```

Verify the ledger:

```bash
curl -s http://localhost:3001/audit | jq .verification
curl -s "http://localhost:3001/audit/export?format=json" -o audit-export.json
pnpm verify:audit audit-export.json
```

Every request is validated with Zod. Scan logs include the scan id. A failed connector is reported as a partial scan when other systems return usable data.
