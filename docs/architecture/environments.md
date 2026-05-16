# Environments

Three logical environments. Same CDK code, different config.

| Env     | Where it runs                                                | When it deploys                       | Cost-tier              |
| ------- | ------------------------------------------------------------ | ------------------------------------- | ---------------------- |
| `local` | docker-compose (LocalStack + DynamoDB Local) on your machine | `pnpm local:up`                       | Free                   |
| `dev`   | AWS account, real services                                   | Auto on every push to `main`          | Tiny (Budget $5/mo)    |
| `prod`  | AWS account, real services                                   | On git tag `v*` after manual approval | Capped (Budget $20/mo) |

## Local

- No AWS account required.
- `docker compose up -d` starts LocalStack + DynamoDB Local.
- `pnpm bootstrap:local` creates the table and a demo secret.
- `pnpm doctor:local` shows a green/red status table.

## Dev

- Auto-deployed on every push to `main`.
- Smoke E2E runs against the deployed URL after each deploy.
- Ephemeral data — wiping the table on dev is fine.

## Prod

- Deployed only on git tag `v*`.
- GitHub environment has a "Required reviewers" protection rule — the deploy job blocks until you approve.
- DynamoDB has Point-in-Time Recovery enabled; removalPolicy `RETAIN`.
- See [deploy-env playbook](../playbooks/deploy-env.md) for the full flow.

## Per-env config

Lives in [`packages/infra/config/`](../../packages/infra/config/) — fully typed via [`EnvConfig`](../../packages/infra/config/types.ts). Differences include Lambda memory, log retention, budget cap, and PITR.
