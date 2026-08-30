# Policy

The customer keeps `keyring.yml` in the repository that owns the access policy. Keyring reads it during a scan and uses it to identify service accounts, protect resources, score stale access, and optionally approve low risk cards.

## Main sections

- `service_accounts` names automation identities, their owners, key ids, and resources.
- `declared_agents` names AI agents, their human owners, runtimes, purposes, and reachable tools.
- `protected` marks resources that always need individual approval.
- `staleness` sets idle thresholds used by risk scoring.
- `auto_approve` defines optional rules. It is disabled by default.
- `reaudit` configures scheduled scans and diff only behavior.

## CI service account

This policy entry tells Keyring that the payments deploy key belongs to CI:

```yaml
service_accounts:
  - id: ci-payments-cdn
    display_name: "GitHub Actions, payments CDN publish"
    owner: "platform@keyring-test.example"
    key_ids:
      - AKIA_KEYRING_CI_ORPHAN_LOOKALIKE
    resource_ids:
      - keyring-test/payments

protected:
  - resource: "keyring-test/payments"
    system: github
    reason: "Production payments CDN, individual approval required"
```

The service account moves the CI key from unknown to a named service account. The protected rule keeps it out of bulk approval. The guided demo holds this card and asks the operator to flag the owner.

## Declared agents

AI agents need a stable declaration even when they use service accounts or
OAuth grants:

```yaml
declared_agents:
  - id: billing-reconciler
    name: "Billing Reconciler"
    runtime: "TrueForge"
    owner: "owner@example.test"
    purpose: "Reconcile billing grants"
    agent_ids:
      - billing-reconciler
    tools:
      - billing-mcp
```

The owner and purpose are required policy facts. Keyring matches an agent by
exact `agent_id` or declared credential `key_id`. It does not use a human
directory record to infer that an agent is declared, and resource overlap
does not turn an agent grant into a service-account grant. A discovered agent
without a matching declaration is labeled unregistered and receives the
highest risk treatment when it holds access.

The agent identity connector currently inventories evidence and does not
mutate the underlying credential. A source connector with a documented live
capability is required before Keyring can change that credential.

## Auto approval

Auto approval is opt in:

```yaml
auto_approve:
  enabled: false
  rules:
    - id: safe-read-reversible
      description: "Reversible read access under risk 35"
      max_capability: read
      reversible_only: true
      max_risk: 35
```

Protected resources and CI cards are never auto approved. A card shows the rule id and records `policy:<rule id>` as the decision author when a rule applies.

## Scheduled re audit

```yaml
reaudit:
  cron: "0 6 * * *"
  diff_only: true
```

The server can start a scheduled scan, compare grant ids with the previous completed scan, emit `scan.diff`, and queue only added or changed grants when `diff_only` is enabled.
