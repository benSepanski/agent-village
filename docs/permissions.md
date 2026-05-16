# Permissions — Always / Ask First / Never

Three-tier list of what an agent (human or LLM) working in this repo may do.
The harness enforces what it can; the rest is on you.

## Always (do without asking)

- Read any file in this repo.
- Run any of: `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `pnpm build`, `pnpm e2e`, `pnpm format`, `pnpm deps:check`,
  `pnpm doctor:local`, `pnpm --filter @agent-village/infra synth`.
- Run `pnpm local:up` and `pnpm local:down` (LocalStack).
- Add a new file inside one existing package.
- Add a new unit test (`*.test.ts`).
- Add a new closed-enum entry to
  [`packages/shared/src/observability/events.ts`](../packages/shared/src/observability/events.ts)
  and use it in a structured log call.
- Add a new Zod schema in `packages/shared/src/schemas/`.
- Add a new ADR in `docs/adr/` (append-only; never edit an existing one).

## Ask first

- Add a new top-level package under `packages/` or `tools/`.
- Weaken or remove a lint rule, or relax a bound (complexity, file length, etc.).
- Change the dependency-cruiser allowed-edges graph.
- Add a new AWS service or resource type (anything not already in `packages/infra/`).
- Change a CDK construct's `removalPolicy` from `RETAIN` to `DESTROY`.
- Modify `.github/workflows/` (CI/CD).
- Change Cognito password or MFA settings.
- Change `monthlyBudgetUsd` in any env config.
- Change DynamoDB `pointInTimeRecovery`, encryption, or billing mode.
- Push a new dependency that pulls in > 10 transitive dependencies.

## Never

- Disable a lint rule inline (`eslint-disable*`) — the lint message tells you the fix.
- Suppress a typecheck error with `@ts-ignore` (use `@ts-expect-error <description>` if you must).
- Commit secrets, API keys, .env contents, or anything matching `.env*`.
- Edit `.husky/` hook contents.
- Edit the contents of an existing ADR — write a new one that supersedes it.
- `git push --force` to `main` (or `--force-with-lease`).
- Run AWS commands against prod from a local script — only the prod deploy
  workflow may touch prod.
- Read or exfiltrate user data outside of the deployed system.
- Modify a User's Cognito record from server code without that User's sub
  matching the request's JWT sub.
- Disable cdk-nag rules without adding an inline `NagSuppressions` with a reason.

## How violations are caught

- `pnpm lint` blocks: most code-level violations.
- `pnpm deps:check` blocks: dependency-graph violations.
- CI blocks: format, lint, typecheck, test, synth, deps, structural tests.
- GitHub branch protection blocks: force-push, unreviewed merge to `main`.
- AWS IAM blocks: cross-env access (deploy roles are env-scoped).
- AWS Budgets alarm: cost overruns.

The rest is on the engineer (or agent) to honor.
