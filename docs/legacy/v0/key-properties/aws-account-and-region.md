# Key property: which AWS account and region are used

**The property:** every deploy targets an explicitly selected environment (`dev` or `prod`), in a region pinned by typed config, in the account of whatever AWS credentials run the deploy. Local development never touches AWS at all.

## Enforcement

| Mechanism                                                                                                                                                                                                                      | Code                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| The CDK app refuses to synth without `--context env=dev` or `--context env=prod`; any other value throws with a prescriptive message                                                                                           | [`loadEnvConfig()` in `config/index.ts`](../../packages/infra/config/index.ts)                                                                |
| Region is hardcoded per environment (`us-east-1` for both today) in typed config — not inferred from the CLI profile                                                                                                           | [`config/dev.ts`](../../packages/infra/config/dev.ts), [`config/prod.ts`](../../packages/infra/config/prod.ts)                                |
| The account is taken from `CDK_DEFAULT_ACCOUNT` (set by the CDK CLI from the active credentials) when present; the config's optional `account` field is otherwise unset, so CDK resolves the account from whoever is deploying | [`loadEnvConfig()`](../../packages/infra/config/index.ts), spread into every stack's `env` in [`bin/app.ts`](../../packages/infra/bin/app.ts) |
| CI deploys assume an env-specific IAM role via GitHub OIDC (`AWS_DEPLOY_ROLE_DEV` / `AWS_DEPLOY_ROLE_PROD` repo secrets) — the role's account is the deploy target, and no long-lived AWS keys exist in the repo               | [`deploy.yml`](../../.github/workflows/deploy.yml)                                                                                            |
| Prod deploys additionally require a git tag `v*` plus manual approval through the GitHub `prod` environment                                                                                                                    | [`deploy.yml`](../../.github/workflows/deploy.yml)                                                                                            |
| Every stack is tagged `Project=agent-village`, `Env=<env>` for billing attribution                                                                                                                                             | [`bin/app.ts`](../../packages/infra/bin/app.ts)                                                                                               |

## Local development is account-free

When `AV_LOCAL=1`, the data layer points at LocalStack and DynamoDB Local with dummy credentials — no AWS account, region, or credential chain is consulted:

- DynamoDB client → `AV_DYNAMO_ENDPOINT` (default `http://localhost:8000`): [`dynamo/client.ts`](../../packages/data/src/dynamo/client.ts)
- Secrets Manager client → `AV_SECRETS_ENDPOINT` (default `http://localhost:4566`): [`secrets/client.ts`](../../packages/data/src/secrets/client.ts)

`pnpm local:up` starts the containers and bootstraps the table ([`docker-compose.yml`](../../docker-compose.yml), [`local-bootstrap.ts`](../../tools/scripts/local-bootstrap.ts)).

## Known limits

- **The account is implicit in the credentials.** `dev` and `prod` are distinguished by resource naming and IAM roles, not by account ID checks — deploying `prod` with dev-account credentials creates prod-named stacks in the dev account. Setting the `account` field in [`config/prod.ts`](../../packages/infra/config/prod.ts) would make CDK refuse mismatched credentials; it is currently unset.
- Both environments share one region (`us-east-1`); there is no multi-region story.
