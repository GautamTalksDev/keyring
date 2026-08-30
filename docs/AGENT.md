# Keyring agent

Keyring runs as a TrueForge agent. TrueForge manages the agent loop, model calls, MCP tools, subagents, sandbox work, approvals, and session persistence. Keyring supplies the access data and governance rules.

The manifest is [`agents/keyring.agent.json`](../agents/keyring.agent.json).

## Agent configuration

- The registered model comes from the configured provider. The local stub is `keyring-stub/keyring-stub`.
- `keyring-scan` contains read only inventory and reconciliation tools.
- `keyring-mutate` contains mutation tools and requires approval for write or destructive calls.
- The `keyring-audit` skill is optional and can be registered from a Git source.
- Dynamic subagents, Generative UI, user questions, and context management are enabled in the manifest.
- The product specific `keyring` block is removed before the manifest is sent to TrueForge.

## Audit flow

1. The agent calls `list_connected_systems` on `keyring-scan`.
2. TrueForge starts one subagent for each returned system.
3. Each subagent calls `inventory_system` once and returns compact grants.
4. The main agent combines grant ids and calls identity reconciliation.
5. Reconciliation runs in the TrueForge sandbox when one is available. The fallback MCP tool uses the same `packages/core` identity code.
6. The agent calls `persist_approval_cards`.
7. The agent stops. It does not call `revoke_grant` during a scan.

The scan has read credentials only. Write credentials are confined to the mutate path and are used after an operator approves an action.

## Local stub path

The stub model is useful for testing TrueForge wiring without paid model calls:

```bash
KEYRING_ALLOW_STUB=1 pnpm stub:model
```

Register the agent after TrueForge and the Keyring MCP endpoints are running:

```bash
pnpm register:agent
```

The script reports response bodies for failed registrations and verifies the agent with `GET /api/v1/agents`.

## Docker networking

When TrueForge runs in Docker, `localhost` inside the container is not the host. The registration script changes local Keyring MCP URLs to `host.docker.internal`. Set `KEYRING_MCP_PUBLIC_URL` when a different reachable URL is required.

On Linux, Docker must be configured to resolve `host.docker.internal`, usually with a host gateway entry.

## Reconnect behavior

TrueForge persists sessions, turns, and events. Closing a browser tab does not cancel an in progress agent turn. Reopen the session or subscribe again to the same turn to continue receiving events.

Keyring's audit ledger is separate from the TrueForge transcript. It records access decisions and execution results for governance.
