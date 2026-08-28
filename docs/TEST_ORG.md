# Test org (messy fixtures)

This is the deliberately messy environment Keyring is judged against. **Fixtures are the source of truth for development** — you do not need live Google / GitHub / Slack calls to build or demo. Live orgs are optional and throwaway.

## The one grant that must survive the demo

After seeding, open [`fixtures/test-org/manifest.json`](../fixtures/test-org/manifest.json) and read `surviveDemo`:

| Field | Meaning |
| --- | --- |
| `grantId` | Deterministic Keyring grant id |
| `resourceId` | `keyring-test/payments` |
| `principalKeyId` | `AKIA_KEYRING_CI_ORPHAN_LOOKALIKE` |
| `marker` | `KEYRING_DO_NOT_REVOKE_CI_INFRA` (in evidence) |
| `proposedAction` | `flag_only` |
| `demoStatus` | `held` |

It **looks** orphaned: `principal.kind = unknown`, empty owner label, no `lastUsedAt`, admin on payments. It is actually the **CI / GitHub Actions deploy key** for prod payments publish. Revoking it breaks release CI. In the demo we **HOLD**, we do not revoke.

## Three fake people

| Person | Work email | Personal Gmail | GitHub username (opaque) |
| --- | --- | --- | --- |
| Ada Lovelace | `ada@keyring-test.example` | `ada.numbers.personal@gmail.com` | `analyticalengine` |
| Grace Hopper | `grace@keyring-test.example` | `grace.h.navy.mail@gmail.com` | `cobol-compiler` |
| Alan Turing | `alan@keyring-test.example` | `enigmamachine88@gmail.com` | `bombe-ops` |

Override any of these via env (see below) when wiring a real throwaway Workspace / org.

## What mess is planted

For the set as a whole (and per person where noted):

- **Clean** grants under work email (Drive, Slack)
- **Personal Gmail** Drive shares (Ada / Grace / Alan)
- **GitHub** access under usernames that do not match legal names
- **Stale** grant unused ~420 days (Grace → Notion legacy runbook)
- **Unowned** API key / IAM principal with no owner label (`AKIA_KEYRING_UNLABELED_BATCH`)
- **High-capability, low-visibility** admin on private Slack `#exec-comp`
- **CI trap** deploy key on `keyring-test/payments` (must survive)

## Reproduce (fixtures only — default)

```bash
pnpm seed:test-org
```

Idempotent: rewrites:

- `fixtures/test-org/people.json`
- `fixtures/test-org/grants.json` (CreateGrantInput shapes for FixtureConnector)
- `fixtures/test-org/grants.materialized.json` (with computed `id`s)
- `fixtures/test-org/manifest.json` (points at the survive-demo grant)
- `packages/connectors/fixtures/test-org-grants.json` (mirror for the connector)

No credentials required.

```bash
pnpm --filter @keyring/connectors exec node -e "..."  # or just pnpm test
```

`FixtureConnector` loads these grants with read-only inventory.

## Optional live throwaway orgs (Monday hand work)

Do this once by hand, then point env at them:

1. Create a throwaway **Google** account or Workspace.
2. Create a throwaway **GitHub org** (e.g. `keyring-test`).
3. Create a throwaway **Slack** workspace.
4. Create the three people (or three free accounts) and note work email / personal Gmail / GitHub logins.

Copy `.env.example` → `.env` (never commit `.env`) and set:

```bash
SEED_LIVE=true
GITHUB_TOKEN=...          # org admin fine-grained or classic with repo + members
GITHUB_ORG=keyring-test
SLACK_BOT_TOKEN=xoxb-...  # optional; auth.test + manual channel invites
GOOGLE_ACCESS_TOKEN=...   # optional OAuth access token with Drive scope
```

Optional per-person overrides:

```bash
KEYRING_TEST_ADA_WORK_EMAIL=...
KEYRING_TEST_ADA_PERSONAL_EMAIL=...
KEYRING_TEST_ADA_GITHUB_USERNAME=...
# same pattern for GRACE and ALAN
```

Then:

```bash
pnpm seed:test-org          # always refreshes fixtures
SEED_LIVE=true pnpm seed:test-org
```

Live GitHub seed is idempotent (ensure private repos + collaborator permissions). Drive folder shares and Slack channel memberships are **documented / best-effort** because IDs differ per workspace — fixtures still mirror the intended mess exactly.

**CI trap live:** create a deploy key on `payments` with an empty/misleading title if you want the live org to match; fixtures already encode it for demos without that step.

### Teardown

```bash
SEED_LIVE=true pnpm teardown:test-org
```

Removes GitHub collaborator grants when tokens are present. Does **not** delete fixture files. Slack/Drive cleanup is manual for throwaways (documented in script output).

## Credentials policy

- Never commit tokens, service account JSON, or `*.credentials.json`.
- Scripts read **only** environment variables.
- `.env` is gitignored; `.env.example` has empty placeholders only.

See also [docs/CONNECTORS.md](docs/CONNECTORS.md) for MCP-backed GitHub / Google Workspace inventory.

1. `pnpm seed:test-org` succeeds without secrets.
2. `fixtures/test-org/manifest.json` → `surviveDemo.grantId` is present.
3. That grant’s evidence contains `KEYRING_DO_NOT_REVOKE_CI_INFRA`.
4. `pnpm test` — FixtureConnector yields the messy set.
