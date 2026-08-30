# TrueForge and Keyring

TrueForge is the agent harness. Keyring is the access governance product that runs on it. The boundary matters because the harness already provides the machinery for agents, tools, sandboxes, approvals, and sessions.

## What TrueForge provides

TrueForge owns:

- The agent loop, including model calls, tool calls, streamed events, and turn completion.
- MCP server registration, tool discovery, credentials, routing, and deferred tool loading.
- Sandboxed compute for code, files, shell commands, and skills.
- Human approval before a configured write or destructive tool call.
- Parallel subagents with separate context and returned results.
- Session, turn, and event persistence across reconnects.
- Context compaction, large tool response handling, Generative UI, and questions for the operator.

## What Keyring provides

Keyring owns:

- The grant model for who has access to which resource.
- Connectors that translate source system data into grants.
- Identity reconciliation across emails, usernames, keys, and directory records.
- Policy for protected resources, service accounts, staleness, and optional auto approval.
- The ApprovalCard queue, which is a durable product workflow.
- Execution rules and dry run behavior.
- The append only audit ledger for decisions and results.

The ApprovalCard queue is not the same as a TrueForge tool approval. TrueForge pauses a sensitive tool call during an agent turn. Keyring presents a reviewable record of access and the proposed action.

## Local demo

The shortest path is:

```bash
pnpm install
pnpm demo
```

This starts an embedded PGlite database, a replay scan, a dry run execution path, and the web UI. It does not need Docker, provider credentials, or a TrueForge service.

## Live harness setup

For a live agent path, start TrueForge, Keyring, and the model provider:

```bash
cd infra
cp .env.example .env
docker compose build
docker compose up
```

In another terminal, start Keyring with Postgres and run the migrations. If a paid model is not configured, start the local stub:

```bash
KEYRING_ALLOW_STUB=1 pnpm stub:model
```

Register the MCP servers and agent:

```bash
pnpm register:agent
```

The registration script verifies that the `keyring` agent appears in the TrueForge agent list. It rewrites host local MCP URLs for a Dockerized TrueForge instance when needed.

## The live scan flow

1. The Keyring agent asks the scan MCP server for connected systems.
2. TrueForge starts one subagent for each system.
3. Each subagent inventories through a read only tool and returns compact grant data.
4. Keyring combines the grant ids and runs reconciliation in the sandbox.
5. Keyring persists ApprovalCards and stops before any revoke.
6. A separate operator decision and execute request can use the mutate MCP server.

The TrueForge session retains the agent turn and events. A client can reconnect to the same session instead of starting another scan.

## Keep the boundary clear

Do not add a custom agent loop, custom subagent scheduler, custom sandbox, custom tool approval pause, or replacement session store to `packages/server`. Use TrueForge for those concerns. Add product behavior to Keyring when it concerns grants, identity evidence, policy, approvals, execution, or the governance ledger.
