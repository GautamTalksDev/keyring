# Costs, caps, and record/replay

Keyring runs on limited credits. This doc covers model providers, the hard spend cap, per-scan accounting, role-based models, and offline demos.

## Provider keys (env only)

Configure TrueForge via **Settings → Models** or `pnpm register:agent`. Keys are read from the environment and sent to TrueForge's model settings API — they **never** appear in `agents/keyring.agent.json`, git, structured logs (beyond “key present”), or the UI.

| Env | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Preferred — registers `openai` with `gpt-4o-mini` + `gpt-4o` |
| `ANTHROPIC_API_KEY` | Used if OpenAI is unset |
| `KEYRING_ALLOW_STUB=1` | Optional local stub provider for zero-cost harness wiring |
| `KEYRING_HARD_CAP_USD` | Override hard cap (default from agent.json `keyring.costs.hard_cap_usd`) |
| `KEYRING_MODEL_INVENTORY` | Override inventory model FQN |
| `KEYRING_MODEL_REASONING` | Override reasoning model FQN |
| `KEYRING_SCAN_DRIVER` | `fixture` \| `trueforge` \| `record` \| `replay` |
| `VITE_SCAN_DRIVER` | UI default driver (same values) |

See [TrueForge models](https://trueforge.dev/models#configuring-a-standard-provider).

```bash
export OPENAI_API_KEY=sk-…   # never commit
pnpm register:agent
```

## Role models (`agents/keyring.agent.json`)

TrueForge AgentSpec has a single `model` today. Keyring adds a **stripped-before-register** extension:

```json
{
  "model": { "name": "openai/gpt-4o-mini" },
  "keyring": {
    "models": {
      "inventory": "openai/gpt-4o-mini",
      "reasoning": "openai/gpt-4o"
    },
    "costs": { "hard_cap_usd": 0.5 }
  }
}
```

| Role | Default | Used for |
| --- | --- | --- |
| `inventory` | `openai/gpt-4o-mini` | Per-system subagent inventory summarisation (mechanical) |
| `reasoning` | `openai/gpt-4o` | Identity reconciliation + risk reasoning |

`pnpm register:agent` uploads the AgentSpec **without** the `keyring` block (TrueForge ignores unknown product fields). Product scan drivers still load role models from the file on disk.

## Hard spend cap

Default **$0.50** per scan (`keyring.costs.hard_cap_usd` or `KEYRING_HARD_CAP_USD`).

When a scan would exceed the cap:

1. Accounting stops further model lines
2. Status becomes `cost_capped`
3. SSE emits `scan.cost_capped`
4. UI banner: scan stopped cleanly (not a crash)

## Per-scan accounting

Every scan tracks input/output tokens and estimated USD (pricing table in `keyring.costs` / defaults in `packages/server/src/costs/config.ts`).

- SSE: `cost.update` during the run
- `GET /scans/:id` and `GET /scans/:id/cards` include `costs`
- UI footer: tokens in/out, cost, cap, recording id

Buyers can answer “what does a scan cost?” from the footer.

## Record / replay

Demo path that cannot be ruined by rate limits.

```bash
# Record (fixture backend + role-cost estimates; zero OpenAI calls)
pnpm record:scan
# → fixtures/recordings/ada-lovelace.json

# Replay offline
pnpm record:scan -- --replay-only
# or API:
curl -X POST localhost:3001/scans -H 'content-type: application/json' \
  -d '{"person":"Ada Lovelace","driver":"replay","recordingId":"ada-lovelace"}'
```

| Driver | Behavior |
| --- | --- |
| `record` | Run scan, write every model/tool interaction + SSE events + cards to `fixtures/recordings/` |
| `replay` | Re-emit events, restore cards/costs from the recording — **zero provider API calls** |

Recordings contain summaries only (no secrets). Safe to commit for demos.

### Live TrueForge record (optional)

```bash
KEYRING_RECORD_WITH=trueforge KEYRING_SCAN_DRIVER=record pnpm record:scan
```

Requires TrueForge + registered real provider. Usage is taken from `model.message.usage` when present.

## Done criteria

1. Real provider configured from env (`pnpm register:agent` with `OPENAI_API_KEY`)
2. One scan recorded: `pnpm record:scan`
3. Replay matches offline: `pnpm record:scan -- --replay-only`
