# Never

Don't do these. Not now, not "just this once."

## Harness bypass

- Disable a lint rule inline (`eslint-disable*`) — the rule message tells you the fix; apply it.
- Suppress a typecheck error with `@ts-ignore` (use `@ts-expect-error <description>` only when truly necessary).

## Secrets / safety

- Commit secrets, API keys, .env contents, or anything matching `.env*`.
- Hard-code an Anthropic API key, even in a test file.
- Read or exfiltrate user data outside the deployed system.
- Modify a User's Cognito record from server code without their JWT sub matching the request.

## Git

- `git push --force` (or `--force-with-lease`) to `main`.
- Edit `.husky/` hook scripts as a way to bypass them.
- Edit the contents of an existing ADR — write a new ADR that supersedes it.
- Skip commit hooks with `--no-verify` unless explicitly authorized by the human.

## AWS

- Run AWS commands against `prod` from a local script. Only the prod deploy workflow may touch prod.
- Manually edit deployed CloudFormation stacks via the AWS Console; the IaC is the source of truth.

## cdk-nag

- Add `NagSuppressions` without writing the `reason` field explaining why.
