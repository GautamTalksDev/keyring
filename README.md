# Keyring

Every company can list its employees. None of them can list what those employees can still access.

Keyring is access governance on [TrueForge](https://trueforge.dev): inventory grants across systems, reconcile identities, queue approvals, execute revokes, and keep an append-only audit ledger.

## Judge path (verbatim)

Requires **Node 20+** and **pnpm 9+**. No Docker, no API keys, no Postgres install.

```bash
pnpm install
pnpm demo
```

(`pnpm demo` builds once if needed.) Open **http://127.0.0.1:5173**, start a scan for **Ada Lovelace**. The UI runs in **replay** mode from `fixtures/recordings/ada-lovelace.json` against embedded **PGlite**. Execution stays **dry-run** by default.

Optional checks (still no credentials):

```bash
pnpm test
pnpm audit:secrets
```

## The problem

Offboarding and access reviews fail because entitlements are scattered: GitHub collaborators, Drive shares to personal Gmail, deploy keys that look orphaned, stale Notion admins. HR can list people; nobody can list what those people can still touch.

## What the harness does vs what we do

| TrueForge (harness) | Keyring (product) |
| --- | --- |
| Agent loop, model calls, MCP tool invocation | Grant model, identity reconciliation |
| MCP auth / deferred tools / approvals mid-turn | Approval queue UI for access decisions |
| Sandbox, subagents, session persistence | Append-only governance audit ledger |
| | Policy (`keyring.yml`), spend cap, record/replay, execute dry-run |

Details: [`docs/HARNESS.md`](docs/HARNESS.md).

## Architecture

```
                    ┌─────────────────┐
   Operator UI ────►│  apps/web       │
   (approve/exec)   └────────┬────────┘
                             │ HTTP / SSE
                    ┌────────▼────────┐
                    │ packages/server │  scans · cards · execute · audit
                    │  MCP /mcp/scan  │  /mcp/mutate (read vs write)
                    └────────┬────────┘
           ┌─────────────────┼─────────────────┐
           ▼                 ▼                 ▼
    packages/core      connectors         TrueForge
    grants · policy    GitHub/Google      agent + MCP
    reconcile · audit  FixtureConnector   (optional live)
           │
           ▼
    Postgres or PGlite (demo) — append-only audit_records
```

## Setup

### Offline demo (default for judges)

```bash
pnpm install && pnpm demo
```

Uses `KEYRING_DEMO=1` → embedded PGlite at `.keyring-pglite-demo`, `KEYRING_SCAN_DRIVER=replay`, `KEYRING_EXECUTE_DRY_RUN=1`.

### Live / full stack

1. Copy env templates: root `.env.example`, `infra/.env.example` → `infra/.env`
2. Start Postgres (or TrueForge stack): `cd infra && docker compose up keyring-db -d` (or full stack)
3. `export DATABASE_URL=postgresql://keyring:keyring@localhost:5432/keyring`
4. `pnpm db:migrate`
5. Optional model keys in env only: `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` — never commit
6. `pnpm --filter @keyring/server start` and `pnpm --filter @keyring/web dev`
7. Register agent: `pnpm register:agent` (TrueForge up)

## Policy file (`keyring.yml`)

Checked into the **customer’s** repo. Declares protected resources, known service accounts, staleness, and optional auto-approve (off by default). See [`docs/POLICY.md`](docs/POLICY.md).

```yaml
service_accounts:
  - id: ci-payments-cdn
    display_name: "GitHub Actions — payments CDN publish"
    owner: "platform@keyring-test.example"
    key_ids:
      - AKIA_KEYRING_CI_ORPHAN_LOOKALIKE
    resource_ids:
      - keyring-test/payments

protected:
  - resource: "keyring-test/payments"
    system: github
    reason: "Prod payments CDN — always individual approval (never bulk)"
```

## Safety guarantees

- **Dry-run default** — `KEYRING_EXECUTE_DRY_RUN=1`. Clones cannot revoke by accident. Pass `dryRun:false` only when intentional ([`docs/EXECUTE.md`](docs/EXECUTE.md)).
- **Read-only scan path** — inventory uses `/mcp/scan` and read credentials; mutates only via `/mcp/mutate` after approval.
- **Append-only ledger** — `audit_records` rejects UPDATE/DELETE at the DB; hash chain verifiable with `pnpm verify:audit`.
- **Hard spend cap** — default `$0.50` (`KEYRING_HARD_CAP_USD`); scan stops cleanly as `cost_capped`.
- **Secrets** — API keys only in env; `pnpm audit:secrets` scans the tree (and git history when `.git` exists).

## UI error states

| Condition | Message | Recovery |
| --- | --- | --- |
| Connector auth failure | Clear auth error from MCP | Re-authorize connector in TrueForge, retry |
| Rate limit | 429 / quota | Wait / lower rate, retry; or use replay |
| Partial scan | Some systems failed | Use successful grants; fix connector; re-scan |
| Spend cap | Cap reached, no further model calls | Raise cap or use `pnpm demo` |
| Execution failure | Per-card failure + undo hint when restorable | Check credentials / dry-run; retry cards |

## More docs

- [`docs/HARNESS.md`](docs/HARNESS.md) · [`docs/POLICY.md`](docs/POLICY.md) · [`docs/COSTS.md`](docs/COSTS.md)
- [`docs/UI.md`](docs/UI.md) · [`docs/API.md`](docs/API.md) · [`docs/EXECUTE.md`](docs/EXECUTE.md)
- [`docs/AGENT.md`](docs/AGENT.md) · [`docs/IDENTITY.md`](docs/IDENTITY.md) · [`docs/CONNECTORS.md`](docs/CONNECTORS.md) · [`docs/TEST_ORG.md`](docs/TEST_ORG.md)

## AI-assistance disclosure

This project was developed with assistance from **Cursor** (AI coding agent). Humans directed product decisions, safety defaults, and review; Cursor was used for implementation, refactoring, tests, and documentation drafting as required by the competition rules.
