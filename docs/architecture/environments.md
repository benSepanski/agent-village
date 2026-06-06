# Environments

Three logical environments, same CDK code, different config. The split
exists so you can iterate fast without breaking the deployed version
and without spending money.

| Env     | Where it runs                                                | When it deploys                       | Cost-tier              |
| ------- | ------------------------------------------------------------ | ------------------------------------- | ---------------------- |
| `local` | docker-compose (LocalStack + DynamoDB Local) on your machine | `pnpm local:up`                       | Free                   |
| `dev`   | AWS account, real services                                   | Auto on every push to `main`          | Tiny (Budget $5/mo)    |
| `prod`  | AWS account, real services                                   | On git tag `v*` after manual approval | Capped (Budget $20/mo) |

## Local

For developing without touching AWS at all. LocalStack runs fake
versions of the AWS services we use, on your laptop, in Docker.

- No AWS account required.
- `docker compose up -d` starts LocalStack + DynamoDB Local.
- `pnpm bootstrap:local` creates the table and a demo secret.
- `pnpm doctor:local` shows a green/red status table.

## Dev

A real AWS deployment intended for "is my latest change broken?" checks.

- Auto-deployed on every push to `main` by
  [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml).
- A Playwright smoke test runs against the deployed URL after each
  deploy.
- Data is treated as ephemeral — wiping the table on dev is fine, and
  the CDK config sets `retainOnDelete: false` so `cdk destroy` cleans
  everything up.

## Prod

The real, customer-visible deployment.

- Deployed only on git tag `v*`.
- The GitHub `prod` environment has a "Required reviewers" rule — the
  deploy job blocks until you click "Approve" in the Actions UI.
- **DynamoDB has Point-in-Time Recovery (PITR) enabled.** PITR is
  AWS's continuous backup feature: it lets you restore the table to
  any second within the last 35 days. It costs a few cents per GB-month.
- **`removalPolicy: RETAIN`** on the table and the SPA bucket. This
  means if someone runs `cdk destroy` against prod, CloudFormation
  leaves those resources in place instead of deleting them — so data
  can't be wiped accidentally by a stray command.
- See [deploy-env playbook](../playbooks/deploy-env.md) for the full
  setup-and-deploy flow.

## Per-env config

Lives in [`packages/infra/config/`](../../packages/infra/config/) —
fully typed via
[`EnvConfig`](../../packages/infra/config/types.ts). Per-env
differences include:

- **Lambda memory** (256 MB dev, 384–512 MB prod).
- **Log retention** (7 days dev, 30 days prod) — see
  [cost-guards](cost-guards.md).
- **Monthly budget cap** ($5 dev, $20 prod).
- **PITR / `retainOnDelete`** (off in dev, on in prod).

To change any of these, edit the matching env file and re-deploy.
