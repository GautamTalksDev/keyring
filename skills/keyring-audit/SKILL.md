# Keyring access audit

This skill audits or offboards a person. It fans out one subagent per system,
reconciles identities in the TrueForge sandbox, persists ApprovalCards, and
stops before any revoke.

Use this skill for **"audit access for …"** and **"offboard …"** requests.

## Steps

1. **List systems** — `list_connected_systems` (keyring-scan).
2. **Fan out** — spawn **one TrueForge subagent per system**. Each subagent calls `inventory_system` once and returns a **compact** grant list only.
3. **Merge** — collect grant ids from every subagent into one set.
4. **Reconcile in the sandbox** (preferred when provisioned):
   - Write `reconcile-input.json` with `{ "grants": [...], "directory": [...] }` (grants can be full fixture grants for the merged ids; directory from the test-org people file or HR export).
   - Run the skill CLI (same module as `pnpm reconcile`):

     ```bash
     node skills/keyring-audit/scripts/reconcile.mjs reconcile-input.json
     ```

   - Capture stdout JSON (clusters + unknown).
5. **Stub / no sandbox** — call MCP `run_identity_reconciliation` with `grant_ids`. It executes the **identical** identity module.
6. **Persist** — `persist_approval_cards` with the reconciliation payload.
7. **Stop** — present ApprovalCards. **Never** call `revoke_grant` on this path. Mutates require TrueForge harness approval via keyring-mutate.

## Invariants

- Raw connector JSON stays in subagent contexts.
- CI trap (`KEYRING_DO_NOT_REVOKE_CI_INFRA`) → held / flag_only.
- Unknown stays unknown.
- Write credentials never appear on inventory tools.
