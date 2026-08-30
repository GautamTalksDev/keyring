# Test organization

The repository includes a deliberately messy fixture organization. It is the default source for development, tests, and the offline demo. It does not require live Google, GitHub, Slack, Notion, or AWS accounts.

## People and identities

The fixtures include:

- Ada Lovelace, `ada@keyring-test.example`, alternate email `ada.numbers.personal@keyring-test.example`, GitHub username `analyticalengine`.
- Grace Hopper, `grace@keyring-test.example`, alternate email `grace.h.navy.mail@keyring-test.example`, GitHub username `cobol-compiler`.
- Alan Turing, `alan@keyring-test.example`, alternate email `enigmamachine88@keyring-test.example`, GitHub username `bombe-ops`.

## Findings planted in the fixtures

The data includes normal work access, personal Gmail shares, usernames that differ from legal names, a stale Notion administrator, an unlabeled AWS key, high capability private Slack access, and a protected CI deploy key.

The protected key is `AKIA_KEYRING_CI_ORPHAN_LOOKALIKE` on `keyring-test/payments`. Its evidence includes `KEYRING_DO_NOT_REVOKE_CI_INFRA`. Policy identifies it as the CI payments service account, proposes `flag_only`, and keeps it held. The guided demo must never revoke it.

## Seed and inspect

```bash
pnpm seed:test-org
pnpm test
```

Seeding rewrites the people, grant, materialized grant, manifest, and connector mirror fixtures. It is safe to run repeatedly.

The manifest at `fixtures/test-org/manifest.json` contains the `surviveDemo` reference. Check that its grant id exists and that the evidence includes the CI marker.

## Optional live organization

Live seeding is separate from the default fixture path. Use a throwaway organization and set credentials only in the environment:

```bash
SEED_LIVE=true pnpm seed:test-org
SEED_LIVE=true pnpm teardown:test-org
```

The scripts support GitHub, Google Workspace, and Slack settings from `.env`. Live cleanup is best effort because provider resource ids differ. Fixture files are not removed by teardown.

## Credential rules

Never commit access tokens, service account JSON, provider keys, or credential files. `.env` is for local use and `.env.example` contains placeholders only.
