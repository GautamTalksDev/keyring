# TrueForge vs Keyring

TrueForge is the **agent harness**. Keyring is the **access-governance product** that runs on top of it. Keep that line sharp: if TrueForge already does it, Keyring must not rebuild it.

Docs: [Introduction](https://trueforge.dev/introduction), [Create an agent](https://trueforge.dev/create-agent/overview), [MCP servers](https://trueforge.dev/mcp-servers), [Harness capabilities](https://trueforge.dev/key-features/overview).

## TrueForge's job (do not reimplement)

| Concern | What TrueForge owns |
| --- | --- |
| **Agent loop** | Plan → model → tool calls → stream events until the turn ends. |
| **MCP tool calls** | Attach connectors by name, discover/invoke tools, handle auth (headers/OAuth), deferred loading. |
| **Sandbox execution** | Provision isolated compute only when needed for code, files, shell, skills, Code Mode. |
| **Human approvals** | Pause before write/destructive (or configured) tool calls until Allow/Deny. |
| **Subagent orchestration** | Spawn parallel subagents, isolate their context, return only final results. |
| **Session persistence** | Durable sessions/turns/events (SQLite locally, Postgres in hosted mode) across reconnects. |

Also leave to the harness: context compaction, large tool-response offloading, Generative UI streaming, and “ask clarifying questions” mid-turn.

## Keyring's job (ours)

| Concern | What we build |
| --- | --- |
| **Grant model** | Domain types and semantics for who has what access where (`packages/core`). |
| **Identity reconciliation** | Matching the same person across source systems (email/aliases/HR ids) into one identity. |
| **Approval queue UI** | Product UI for reviewing access decisions (`apps/web`) — product workflow, not the harness chat approval pause. |
| **Audit ledger** | Immutable product record of discoveries, decisions, and grant changes for compliance. |

We also own **source-system connectors** (behind Keyring interfaces / MCP servers we publish), the **HTTP API** that talks to TrueForge and storage, and product policy about *what* should be approved — while TrueForge owns *how* a sensitive tool call is gated mid-turn.

## Run the harness locally

**Personal / quick:** `npx @truefoundry/trueforge@latest` → [http://localhost:8790](http://localhost:8790) (SQLite).

**Judge / full stack** (from `infra/`):

```bash
cp .env.example .env
docker compose up --build
```

→ TrueForge UI/API at [http://localhost:8791](http://localhost:8791), Postgres on `5433`, Redis on `6380`.

Redis is included because TrueForge **hosted mode** (`STANDALONE=false`) requires it for executor peering alongside Postgres — even with one replica ([Quickstart](https://trueforge.dev/quickstart)).

Agent definition (AgentSpec): [`agents/keyring.agent.json`](../agents/keyring.agent.json). See [`AGENT.md`](./AGENT.md) for MCP mounts, stub model, subagent fan-out, and the reconnect demo. Register with `pnpm register:agent` (or the UI / `POST /api/v1/agents`) after Keyring server + stub model are up.

## Duplication flags (future plan)

Watch for these smells — they mean we are reimplementing the harness:

1. **Custom agent/tool execution loop** in `packages/server` instead of TrueForge sessions/turns/SSE.
2. **Homegrown “pause for human before tool X”** runtime — use MCP `require_approval_for_tools` / harness annotations.
3. **In-process code runner or container sandbox** for agent skills — use TrueForge sandbox-as-tool.
4. **Fan-out workers that mimic subagents** for context isolation — use `config.dynamic_sub_agents`.
5. **Rebuilding chat session/history storage** for agent turns — use TrueForge session persistence; Keyring’s audit ledger is for *governance* events, not harness transcripts.
6. **Embedding credentials in agent JSON** — connectors hold secrets; agents only reference MCP servers by name.

The product **approval queue** is *not* a duplicate of harness tool approval: harness approval gates a live tool call; the queue is Keyring’s durable backlog of access decisions for operators.
