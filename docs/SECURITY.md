# Security model

Keyring is an access review tool. It inventories grants, reconciles them to
people, presents approval cards, and executes only approved actions. It is
intended to run on a trusted machine or behind an authenticated private
network. The HTTP server does not provide user authentication or authorization.

## What Keyring can access

Access depends on the connector and the credentials supplied by the harness:

- Read credentials can retrieve identity, membership, permission, key, and
  sharing metadata from configured systems.
- Write credentials can be used by the mutation path to revoke a grant after
  an approval card has been approved.
- The application stores grant snapshots, evidence, approval decisions, and
  audit records. It does not need to store provider credentials in the
  database.
- TrueForge may have additional access according to its own agent, connector,
  model, and sandbox configuration.

Put provider credentials in environment variables or the external harness.
Do not put them in fixtures, agent manifests, recordings, policies, prompts,
or API request bodies.

## What Keyring cannot do by design

These are application design guarantees, not a substitute for deployment
access controls:

- The scan MCP mount creates only read credentials and has no revoke tool.
- The mutate MCP mount exposes only `revoke_grant` and is expected to be
  approval-gated by the harness.
- Scanning never calls the revoke connector.
- Execution defaults to dry run. Live mutation requires an explicit
  configuration change.
- Protected cards cannot be bulk approved.
- Decisions are intent records. A separate execute request is required before
  a connector mutation is attempted.
- Credentials are redacted from API serializers, server sent events, MCP
  results, connector errors, and application log fields.

The server has no built-in identity layer. Anyone who can reach it can call
its HTTP and MCP endpoints. Keep the default loopback listener, or put
authentication and network controls in front of any explicitly configured
non-loopback listener.

## Enforcement layers

Application checks enforce input schemas, card existence, protected-card
rules, dry-run defaults, connector selection, credential kinds, and the
separation between scan and mutation tools. API failures return a generic
internal error rather than a stack trace or filesystem path.

The database is the stronger enforcement boundary for the audit ledger. The
`audit_records_append_only` trigger rejects UPDATE and DELETE operations, so
application code cannot edit or remove an audit row through normal database
operations. Audit appends are serialized and hash-linked, and the API exposes
chain verification.

The demo reset endpoint is available only when `KEYRING_DEMO=1`. It resets
approval card decisions for another recording take. It does not disable the
audit trigger or delete audit records. This preserves the ledger even when a
take is stopped.

Database administrators can always defeat database controls by changing the
database schema or disabling triggers. Protect database credentials and
restrict database administration separately from the application service.

## Data handling

Fixture identities, handles, organizations, and email addresses are synthetic
test data. The familiar names in the demo are fictional examples and are not
directory exports. Recordings and fixtures must remain synthetic and must not
be replaced with production exports before publication.

The secret audit checks the working tree and every commit reachable from local
Git refs and reflogs for high confidence API keys, access tokens, and private key blocks.
It deliberately does not treat synthetic identifiers such as
`AKIA_KEYRING_CI_ORPHAN_LOOKALIKE` as AWS credentials. Review the output of
`pnpm audit:secrets` before publishing a new branch or recording.

Responses and logs can still contain ordinary access metadata, such as email
addresses, usernames, resource names, and evidence claims. Treat those as
organization data. Redaction protects credentials; it is not anonymization.

## Export signing

Audit exports are signed with `KEYRING_EXPORT_SECRET`. Keyring fails closed
with an explicit error when this setting is missing; it never creates a
temporary or random signing key. Configure and protect a stable secret before
using `/audit/export`, otherwise the export cannot be verified across server
restarts.

## Before connecting a real organization

1. Run the service on a private interface or behind authenticated ingress.
2. Keep `KEYRING_EXECUTE_DRY_RUN` enabled until the full workflow is reviewed.
3. Use least-privilege read credentials for inventory and separate,
   approval-gated write credentials for execution.
4. Set a non-default export signing secret and protect it like a credential.
5. Review the scan scope, identity matches, protected cards, and evidence
   before approving anything.
6. Treat model output and MCP responses as untrusted input. Keep TrueForge
   sandboxing and tool approval settings enabled where available.
7. Back up the database and restrict direct database access.
8. Do not commit `.env` files, credentials, database files, production
   recordings, or production exports.

## Public repository settings

For a public GitHub repository, enable protected default and release branches,
required pull request review, required status checks, stale review dismissal,
and signed commits if the team uses them. Restrict who can create, approve,
and merge pull requests. Enable secret scanning, push protection, Dependabot
alerts, and automated dependency updates. Limit GitHub Actions permissions to
read by default, pin third party actions to reviewed commit SHAs, require
environments for releases, and keep deployment credentials out of pull
requests from forks. Review the repository and organization member list,
webhooks, deploy keys, packages, and Actions artifacts regularly.
