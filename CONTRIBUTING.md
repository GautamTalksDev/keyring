# Contributing

All work goes through pull requests. Do not push directly to `main`.

## Getting started

1. Install Node 20+ and [pnpm](https://pnpm.io/).
2. Copy `.env.example` to `.env` and fill in local values (never commit real secrets).
3. Start infra (includes Keyring Postgres on `:5432`): `cd infra && cp .env.example .env && docker compose up -d`
4. From the repo root:

```bash
pnpm install
pnpm db:migrate
pnpm seed:test-org
pnpm build
pnpm test
```

## Development

```bash
pnpm dev
```

Runs the API server and the web app together.

## Before opening a PR

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- Keep commits focused; prefer small PRs.

## Secrets

Never commit `.env`, `.env.*` (except `.env.example`), or any `*.credentials.json` files.
