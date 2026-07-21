# Key property: how multiple deployments coexist

**The property:** every deployment is isolated — resource names are prefixed by
environment, so multiple deployments (first-party + dependent repos) never share
or collide on any resource, even in the same AWS account.

## First-party environments (dev / prod)

| Mechanism                                                                                                                                                                                                                                                                                                                      | Code                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each environment owns a `prefix` (`agent-village-dev` / `agent-village-prod`) in typed config; all seven stacks are named `${prefix}-<purpose>`                                                                                                                                                                                | [`config/dev.ts`](../../packages/infra/config/dev.ts), [`config/prod.ts`](../../packages/infra/config/prod.ts), stack instantiation in [`bin/app.ts`](../../packages/infra/bin/app.ts)                                                                                                                                                                                                                                       |
| Physical resource names are all prefix-derived: DynamoDB table (`${prefix}`), Lambda functions (`${prefix}-runner`, `${prefix}-api-<handler>`), SNS topic (`${prefix}-alarms`), schedule group (`${prefix}-agents`), ECR repo (`${prefix}-sandbox-base`), web bucket (`${prefix}-web`), log groups (`/aws/lambda/${prefix}-…`) | [`data-stack.ts`](../../packages/infra/src/stacks/data-stack.ts), [`api-stack.ts`](../../packages/infra/src/stacks/api-stack.ts), [`runner-stack.ts`](../../packages/infra/src/stacks/runner-stack.ts), [`monitoring-stack.ts`](../../packages/infra/src/stacks/monitoring-stack.ts), [`sandbox-stack.ts`](../../packages/infra/src/stacks/sandbox-stack.ts), [`web-stack.ts`](../../packages/infra/src/stacks/web-stack.ts) |
| Secrets are namespaced by environment: `agent-village/{env}/agents/{agentId}/anthropic-key`                                                                                                                                                                                                                                    | [`secretName()` in `secrets/anthropic.ts`](../../packages/data/src/secrets/anthropic.ts)                                                                                                                                                                                                                                                                                                                                     |
| IAM policies grant secret access only on the env-specific path, so dev Lambdas cannot read prod keys even in a shared account                                                                                                                                                                                                  | secret-ARN policies in [`runner-stack.ts`](../../packages/infra/src/stacks/runner-stack.ts) and [`api-stack.ts`](../../packages/infra/src/stacks/api-stack.ts)                                                                                                                                                                                                                                                               |
| Runtime code learns its environment only through injected env vars (`AV_ENV`, `AV_TABLE_NAME`, `AV_SCHEDULER_GROUP`, …) set by the stack that deployed it — nothing is hardcoded in app code                                                                                                                                   | Lambda `environment` blocks in [`api-stack.ts`](../../packages/infra/src/stacks/api-stack.ts) and [`runner-stack.ts`](../../packages/infra/src/stacks/runner-stack.ts)                                                                                                                                                                                                                                                       |
| Deploy data-safety differs by env: prod has DynamoDB PITR and `RemovalPolicy.RETAIN` on stateful resources; dev is fully destroyable                                                                                                                                                                                           | `retainOnDelete` / PITR wiring in [`data-stack.ts`](../../packages/infra/src/stacks/data-stack.ts), [`web-stack.ts`](../../packages/infra/src/stacks/web-stack.ts), [`sandbox-stack.ts`](../../packages/infra/src/stacks/sandbox-stack.ts)                                                                                                                                                                                   |
| CI serializes deploys per ref via a `concurrency` group, so two pushes cannot run CloudFormation against the same env simultaneously                                                                                                                                                                                           | [`deploy.yml`](../../.github/workflows/deploy.yml)                                                                                                                                                                                                                                                                                                                                                                           |

What differs between the environments (memory, retention, budget, PITR): [environments](../architecture/environments.md).

## Dependent deployments (custom environments via config injection)

A dependent repo (e.g. apply-bot, a team fork) can deploy its own platform
instance **without modifying platform source**. The mechanism:

1. **Config injection (AC-5.1)**: The config loader accepts a `--context env=<name>`
   value that is _not_ `dev` or `prod`. If the env name is unknown, it reads a
   Zod-validated JSON file from `AV_ENV_CONFIG_PATH` (set at synth time). For
   `dev`/`prod` the checked-in config always wins — `AV_ENV_CONFIG_PATH` is
   only ever consulted for a non-reserved env name, so a dependent deploy can
   never silently override a first-party environment.

   The injected config must provide:
   - `env`: a non-reserved string (cannot be `dev` or `prod`).
   - `prefix`: must match `^[a-z][a-z0-9-]*$` (S3/DNS-safe), cannot be a reserved
     prefix (`agent-village-dev` or `agent-village-prod`), length-bounded. All
     resource names derive from this prefix.
   - `region`, `account` (optional, falls back to `CDK_DEFAULT_ACCOUNT`), and all
     other `EnvConfig` fields (memory, retention, budget, alarmEmail, etc.).

   Example:

   ```json
   {
     "env": "apply-bot",
     "prefix": "apply-bot",
     "region": "us-east-1",
     "account": "123456789012",
     "retainOnDelete": true,
     "runnerMemoryMb": 1024,
     "apiMemoryMb": 512,
     "logRetentionDays": 30,
     "sandboxTaskCpu": 512,
     "sandboxTaskMemoryMb": 1024,
     "monthlyBudgetUsd": 20,
     "budgetDriftThresholdUsd": 2,
     "alarmEmail": "ops@apply-bot.example.com"
   }
   ```

2. **Programmatic import (advanced)**: A dependent repo can fork this repo's
   `bin/app.ts` and `packages/infra/config/`, constructing `EnvConfig` in
   TypeScript (e.g. reading from computed values or environment variables),
   validating it through `EnvConfigSchema`, and calling `buildApp(app, config)`
   (both exported from `@agent-village/infra`, `packages/infra/index.ts`).

   This path is for configs that cannot be expressed as static JSON.

## Uniqueness guarantees

**Reserved prefixes** prevent a dependent deployment from shadowing first-party
stacks:

- `agent-village-dev` and `agent-village-prod` are reserved for the first-party
  deployments.
- Any injected config that tries to use these prefixes will be rejected at synth time.

**Cross-deployment uniqueness** (dependent-to-dependent) cannot be enforced in a
single synth (there is no registry). **Operator responsibility**: if deploying
multiple custom environments in the same account, ensure each has a unique
`prefix`. Naming convention: `<project>-<environment>` (e.g. `apply-bot-dev`,
`research-sandbox-team-a`).

**Account/region-based uniqueness**: Some resources are globally or
account-unique:

- S3 bucket names are globally unique; the prefix becomes the bucket name.
- IAM role names are account-unique; prefix-derived role names must not collide.

Avoid deploying two instances with the same prefix in the same account.

## Example: deploying apply-bot's platform instance

A dependent repo (e.g. apply-bot) that needs its own platform instance:

```bash
# In the apply-bot fork or workspace:
export AV_ENV_CONFIG_PATH=./platform-config/apply-bot.env.json
export AV_CDK_ENV=apply-bot    # matches "env" in apply-bot.env.json
export PATH=~/.nvm/versions/node/v22.19.0/bin:$PATH
pnpm install
pnpm build
pnpm --filter @agent-village/infra synth
pnpm --filter @agent-village/infra exec cdk bootstrap aws://YOUR_ACCOUNT/us-east-1
pnpm --filter @agent-village/infra deploy
```

The stack names will be `apply-bot-data`, `apply-bot-api`, etc. Using
`synth:dev`/`deploy:dev` here instead (which hardcode `--context env=dev`)
would silently ignore `AV_ENV_CONFIG_PATH` and re-synth/deploy the
first-party dev config under `agent-village-dev-*` names — see the note in
[Dependent deployments](#dependent-deployments-custom-environments-via-config-injection)
above.
