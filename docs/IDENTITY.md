# Identity reconciliation

Identity reconciliation groups access grants by the person, service account, or AI agent that most likely owns them. It keeps uncertain grants in `unknown` instead of forcing them into a person.

## Evidence order

The strongest signals are:

1. An exact work email match.
2. A commit email that matches a work email.
3. A personal email listed on the same directory record.
4. A username listed on the directory record.
5. A key or token attribution that names a resolved principal.
6. A unique timing match with an onboarding window.
7. Username similarity to a display name.

AI agents use a separate path. A declared agent is matched only by an exact
agent identifier or an explicitly declared credential identifier. Runtime,
purpose, reachable tools, registering party, and declaration status stay on
the agent principal. Human directory signals never declare an agent, and an
agent grant is never merged into a service-account cluster because of a
shared resource.

The first four signals are certain when the source data is reliable. Key attribution and timing are probable or speculative. Username similarity is probable only and is skipped when it is ambiguous.

Every resulting card includes its confidence and a readable inference chain. An unresolved principal remains unknown and is called out in the queue.

## Run the local module

The reconciliation module accepts JSON and returns JSON. It makes no network calls.

```bash
pnpm -F @keyring/core build
pnpm reconcile fixtures/test-org/reconcile-input.json
```

The input contains `grants`, `directory`, and optional `keyAttributions`:

```json
{
  "grants": [],
  "directory": [
    {
      "displayName": "Ada Lovelace",
      "workEmails": ["ada@keyring-test.example"],
      "personalEmails": ["ada.numbers.personal@keyring-test.example"],
      "usernames": ["analyticalengine"]
    }
  ],
  "keyAttributions": []
}
```

## Test data

The test organization produces human clusters for Ada Lovelace, Grace Hopper,
and Alan Turing, plus declared agent clusters for the Keyring Reconciler and
Keyring itself. The policy can resolve the CI payments service account. The
unregistered deployment agent remains unattributed and receives the highest
risk score. The unlabeled AWS key remains unknown. The protected CI card stays
held and flag only.
