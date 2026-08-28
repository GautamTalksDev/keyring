# Policy (`keyring.yml`)

Customer-owned policy checked into **their** repo. Keyring loads it on every scan.

## Location

```
KEYRING_POLICY_PATH   # optional override
# default: <repo>/keyring.yml
```

## Sections

| Block | Purpose |
| --- | --- |
| `protected` | Resource patterns that always need individual approval — **never bulk-approved** |
| `service_accounts` | Known automation identities (keys + resources + owner). Resolves orphan lookalikes. |
| `staleness` | Per-system idle thresholds for risk scoring |
| `auto_approve` | Optional safe auto-approve rules — **`enabled: false` by default**; UI shows which rule fired |
| `reaudit` | Cron + diff-only scheduled scans |

## Worked example — Checkpoint 4 CI trap

The demo deploy key `AKIA_KEYRING_CI_ORPHAN_LOOKALIKE` on `keyring-test/payments` looks orphaned until declared:

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
    reason: "Prod payments CDN — always human approval"
```

After this:

1. Reconcile seeds a **service_account** cluster (not `unknown`)
2. The ApprovalCard gets `attribution.resolvedTo` → leaves the **Unattributed** pin
3. It stays **held / flag_only** (CI trap marker) and **Protected** (no bulk approve)

## Auto-approve

```yaml
auto_approve:
  enabled: false   # flip to true only when you mean it
  rules:
    - id: safe-read-reversible
      description: "Reversible read-only grants under risk 35"
      max_capability: read
      reversible_only: true
      max_risk: 35
```

Protected resources and CI traps never auto-approve. When a rule fires, the card shows `Auto: <rule-id>` and `decision.by = policy:<rule-id>`.

## Scheduled re-audit

```yaml
reaudit:
  cron: "0 6 * * *"   # or set KEYRING_REAUDIT_CRON
  diff_only: true
```

The server arms a cron job on boot. Each run starts a scan with `reaudit: true`, diffs grant ids against the previous completed scan, emits `scan.diff` SSE, and (when `diff_only`) only queues cards for **added/changed** grants (plus held/protected).

```bash
# Manual re-audit
curl -s -X POST localhost:3001/scans \
  -H 'content-type: application/json' \
  -d '{"reaudit":true,"diffOnly":true,"person":"scheduled-reaudit"}'
```

New access appearing is reported the same way as old access lingering (`added` vs `removed` in the diff).
