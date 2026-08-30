# Contributing

Keyring changes are reviewed through pull requests. Do not push directly to `main`.

## Start here

Install Node 20 or newer and pnpm 9 or newer.

```bash
pnpm install
pnpm demo
```

The demo needs no credentials. For server work that uses Postgres, copy `.env.example` to `.env`, start the database from `infra`, and run the migrations.

## Before opening a pull request

Run the checks from the repository root:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm audit:secrets
```

Keep each change focused. Add a regression test when fixing a bug. Update the relevant documentation when behavior or configuration changes. Do not include generated build output or local database files.

## Secrets

Never commit `.env`, credential files, provider keys, access tokens, or service account JSON. The only env file intended for the repository is `.env.example`, and it must contain placeholders only.

## Pull requests

Describe the user-visible change, the safety impact, and the checks you ran. Call out any live provider behavior that was not tested. Keep commits and review comments factual and specific.
