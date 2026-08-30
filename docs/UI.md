# Approval queue UI

The product surface in `apps/web`. Dense, calm, keyboard-driven — Linear/Vercel dashboard register, not a marketing page.

## Layout

- **Left:** agent activity (SSE) — subagents per system, counts found, sandbox banner when identity reconciliation runs
- **Right:** approval queue — Unattributed pinned first, then attributed; cards show everything without a click

## Card contents (always visible)

## Card contents (always visible)

Principal + confidence, system/capability/resource, created & last-used with staleness, risk score + reasons, **Restorable** / **Permanent** badge, **Protected** (keyring.yml), **Auto: &lt;rule-id&gt;** when an auto-approve rule fired, plain-English attribution.

## Actions

Approve / Hold (note required) / Reject. Bulk select + bulk approve/reject — **protected cards are never bulk-approved**. Keyboard: `j`/`k` move, `a`/`h`/`r` decide, `x` select.

## Execute

Separate step: summary of approved actions, Restorable vs Permanent callouts, **dry-run on by default**, explicit confirm, then per-card results (including undo hints when restorable). Approving never executes.

## Guided demo

The replay demo exposes **Run guided demo**. It starts a real replay scan, waits on
the five-system SSE activity, approves safe cards individually, then pauses on the
protected CI card. **Continue** records the human hold with the note
`belongs to CI, flag the owner`, executes approved cards through the API, and ends
on the verified audit ledger. **Stop** aborts the guided controller and resets the
take; running it again creates a fresh scan. The controls are not rendered outside
demo/replay mode.

## Run

```bash
# API
DATABASE_URL=postgresql://keyring:keyring@localhost:5432/keyring pnpm --filter @keyring/server start

# UI (proxies /scans /cards to :3001)
pnpm --filter @keyring/web dev
```

Open http://localhost:5173 — start a scan for `Ada Lovelace`.
