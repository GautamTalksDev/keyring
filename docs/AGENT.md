# Keyring agent (Checkpoint 7)

Keyring runs as a **TrueForge agent** — not a custom loop. The harness owns planning, tool calls, subagents, sandbox, approvals, and session persistence.

## AgentSpec

[`agents/keyring.agent.json`](../agents/keyring.agent.json)

| Piece | Value |
| --- | --- |
| Model (free) | `keyring-stub/keyring-stub` — OpenAI-compatible stub |
| MCP | `keyring-scan` (read-only) + `keyring-mutate` (revoke, approval required) |
| Sandbox | `config.sandbox.enabled: true` |
| Subagents | `config.dynamic_sub_agents.enabled: true` |
| Skill | `keyring-audit` (git-backed when `KEYRING_SKILL_GIT_URL` is set) |
| Approvals | `keyring-mutate.require_approval_for_tools`: `@write`, `@destructive`, `revoke_grant` |

## Flow: audit / offboard

1. `list_connected_systems` → one TrueForge **subagent per system**.
2. Each subagent: `inventory_system` → **compact Grants** only (FixtureConnector, read creds).
3. Main agent merges ids → runs **identity reconciliation** (sandbox CLI preferred; stub uses MCP `run_identity_reconciliation` — same `@keyring/core` module).
4. `persist_approval_cards` → risk + ApprovalCards in Postgres (when `DATABASE_URL` is set).
5. **Stop.** Never revoke on the scan path. Write credentials exist only on `keyring-mutate`.

## Zero-cost local run

```bash
# Terminal A — TrueForge (session persistence)
cd infra && cp -n .env.example .env && docker compose up --build

# Terminal B — Keyring MCP + API
export DATABASE_URL=postgresql://keyring:keyring@localhost:5432/keyring
pnpm db:migrate
pnpm --filter @keyring/core build
pnpm --filter @keyring/server build
pnpm --filter @keyring/server start

# Terminal C — stub model (no paid LLM)
KEYRING_SCAN_DELAY_MS=1000 pnpm stub:model

# Terminal D — register connectors + agent
pnpm register:agent
```

Then either:

- Open http://localhost:8791 → agent **keyring** → `audit access for Ada Lovelace`
- Or: `KEYRING_SCAN_DELAY_MS=1000 pnpm demo:reconnect` (drop client mid-turn, poll — turn still running)

### Docker networking

Compose TrueForge cannot reach `localhost` on the host. `register:agent` rewrites Keyring MCP URLs to `host.docker.internal`. Override with:

```bash
KEYRING_MCP_PUBLIC_URL=http://host.docker.internal:3001 \
KEYRING_STUB_MODEL_URL=http://host.docker.internal:4099/v1 \
pnpm register:agent
```

On Linux, ensure Docker can resolve `host.docker.internal` (Compose `extra_hosts` or use the host gateway IP).

## Reconnect (film this)

TrueForge persists sessions/turns/events in Postgres (hosted mode). Killing the browser tab does **not** cancel the turn.

1. Start `audit access for …` with `KEYRING_SCAN_DELAY_MS` high enough to notice.
2. Close the tab.
3. Reopen the session (or `subscribeToTurn` / `getTurn` via API).
4. Watch the same turn still running / completing.

SDK recipe: [Resume a stream](https://trueforge.dev/api/use-agent#resume-a-stream) — persist `session.id`, `turnId`, `afterSequenceNumber`.

## Separation of concerns

| Do in TrueForge | Do in Keyring |
| --- | --- |
| Agent loop, subagents, sandbox, tool approval, session SSE | Grants, reconcile module, ApprovalCards, audit ledger, connectors |

Do **not** hand-roll an agent loop, tool router, or approval pause in `packages/server`. See [`HARNESS.md`](./HARNESS.md).
