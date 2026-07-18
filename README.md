# agent-village

Personal multi-tenant scheduler for autonomous AI agents, AWS-hosted, TypeScript everywhere.

## Quick start

```bash
nvm use                          # picks Node 22 from .nvmrc
pnpm install
pnpm local:up                    # docker compose up + bootstrap LocalStack
pnpm doctor:local                # green-status table of local stack
pnpm dev                         # SPA at http://127.0.0.1:5173
```

## Working in the repo

```bash
pnpm lint                        # all hard bounds + custom rules
pnpm typecheck                   # tsc across the workspace
pnpm test                        # vitest across the workspace
pnpm e2e                         # playwright (boots web automatically)
pnpm build                       # turbo build
pnpm --filter @agent-village/infra synth:dev
```

## Building an app on the platform

Applications live in their own repos and drive everything through the
`village` CLI (no AWS credentials needed): see
[docs/app-development.md](docs/app-development.md). Reference app:
[examples/gmail-agent](examples/gmail-agent/).

```bash
pnpm cli:pack                    # build an installable CLI tarball
npm i -g <tarball>               # then: village login / init / agents / workspace / run / logs
```

## Project documentation

- [AGENTS.md](AGENTS.md) — the map. Read this first.
- [docs/README.md](docs/README.md) — the doc index. Pattern-match questions to files.
