# Ask first

These actions may be the right thing to do — but pause and confirm with the human before proceeding, because they change the shape of the project or its blast radius.

## Project shape

- Add a new top-level package under `packages/` or `tools/`.
- Change the [dependency-cruiser](../../.dependency-cruiser.cjs) allowed-edges graph.
- Add a new file type to the lint / format pipelines.
- Modify [`.github/workflows/`](../../.github/workflows/) (CI/CD).

## Harness weakening

- Weaken or remove a lint rule.
- Raise a bound (complexity, file length, etc.).
- Disable a `cdk-nag` rule via `NagSuppressions` (acceptable when paired with a written reason).

## AWS surface

- Add a new AWS service or resource type that isn't already in `packages/infra/`.
- Change a CDK construct's `removalPolicy` from `RETAIN` to `DESTROY` (or vice versa) on a stateful resource.
- Change DynamoDB `pointInTimeRecovery`, encryption, or billing mode.
- Change Cognito password policy or MFA settings.
- Change `monthlyBudgetUsd` in any env config.

## Dependencies

- Add a new dependency that pulls in > 10 transitive packages.
- Pin a major version of an existing dependency.

If in doubt: ask. The cost of pausing is low; the cost of an unwanted irreversible change is high.
