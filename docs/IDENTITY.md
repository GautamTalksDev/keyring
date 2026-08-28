# Identity reconciliation

This is Keyring’s moat: cluster an unordered pile of grants into **people** and **service accounts**, with a confidence level and a plain-English inference chain. Anything we cannot attribute stays in **`unknown`** — never guessed into a tidy person to pad the numbers.

## Signals (descending trust)

1. Exact work-email match — `certain`
2. Commit email ↔ work email — `certain`
3. Personal email on the org directory record — `certain`
4. Username listed on the directory record — `certain`
5. Username ↔ display-name similarity (e.g. `schen-dev` → Sarah Chen) — **`probable` only, never `certain`**; skipped when ambiguous
6. Key/token attribution to a resolved principal — `probable`
7. Temporal correlation with a unique onboarding window — `speculative`

## Run in the TrueForge sandbox

The module is self-contained JSON → JSON (no network):

```bash
pnpm --filter @keyring/core build
pnpm reconcile fixtures/test-org/reconcile-input.json
# equivalent:
node packages/core/dist/identity/cli.js fixtures/test-org/reconcile-input.json
```

Input shape:

```json
{
  "grants": [ /* CreateGrantInput or materialized Grant */ ],
  "directory": [
    {
      "displayName": "Ada Lovelace",
      "workEmails": ["ada@keyring-test.example"],
      "personalEmails": ["ada.numbers.personal@gmail.com"],
      "usernames": ["analyticalengine"],
      "onboardedAt": "2024-01-15T00:00:00.000Z"
    }
  ],
  "keyAttributions": [
    { "keyId": "AKIA…", "attributedTo": "ada@…", "source": "cloudtrail" }
  ]
}
```

On the fixture test org this yields **three human clusters** (Ada, Grace, Alan) plus the **CI payments CDN service account** when `keyring.yml` declares it — see [`POLICY.md`](./POLICY.md). The **AWS unlabeled key** stays in `unknown`. The CI trap deploy key is held/flag-only and **no longer unattributed** once declared under `service_accounts`.
