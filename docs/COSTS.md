# Costs and replay

Keyring records model usage for each scan and stops work at a hard spending limit. The offline demo uses a checked in recording and does not call a model provider.

## Provider configuration

TrueForge receives provider configuration from its settings API. `pnpm register:agent` reads keys from the environment and never writes them to the agent manifest.

- `OPENAI_API_KEY` registers OpenAI and prefers `openai/gpt-4o-mini`.
- `ANTHROPIC_API_KEY` registers Anthropic when an OpenAI key is not present.
- `KEYRING_ALLOW_STUB=1` enables the local `keyring-stub/keyring-stub` provider.
- `KEYRING_MODEL_INVENTORY` and `KEYRING_MODEL_REASONING` select product role models.
- `KEYRING_HARD_CAP_USD` overrides the default hard cap of `$0.50`.

Keys are read from environment variables. They are not stored in recordings, agent JSON, or logs.

## Role models

The product manifest stores separate model choices for inventory and reasoning. TrueForge receives one registered model name. Inventory models summarize each system's grants. The reasoning model reconciles identities and creates risk explanations.

## Hard cap

When projected spend reaches the cap:

1. The cost ledger stops further model work.
2. The scan status becomes `cost_capped`.
3. The API emits `scan.cost_capped`.
4. The UI reports that the scan stopped cleanly.

The client treats `completed`, `partial`, `failed`, and `cost_capped` as terminal scan states.

## Per scan accounting

The API and UI expose input tokens, output tokens, estimated cost, cap, and whether the cap was reached. TrueForge usage is used when the live driver reports it. Fixture and replay drivers use their stored or estimated cost values.

## Record and replay

Recordings store event history, compact tool summaries, costs, grant ids, and cards. They do not store provider credentials or raw secret values.

```bash
pnpm record:scan
pnpm demo
```

The demo sets replay mode, uses embedded PGlite, and keeps execution in dry run mode. Replay restores the recorded cards and costs without provider API calls.

## Cost checks

Use `pnpm test` for the cost ledger tests and integration checks. Use `pnpm audit:secrets` before committing a recording or sharing a branch.
