# How violations are caught

| Gate                           | Catches                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| `pre-commit` hook              | Lint + format on staged files; dependency-cruiser layer violations                   |
| `pre-push` hook                | Full repo lint + typecheck + test + cdk synth                                        |
| `commit-msg` hook              | Subject line format (conventional type or `Phase N:`)                                |
| CI (`ci.yml` on every PR)      | Format, lint, typecheck, test, build, synth, deps:check, structural tests            |
| GitHub branch protection       | Force-push, unreviewed merge to `main`                                               |
| GitHub environment             | Required reviewer on prod deploys                                                    |
| AWS IAM                        | Cross-env access (deploy roles are env-scoped)                                       |
| AWS Budgets alarm              | Cost overruns                                                                        |
| Cognito JWT authorizer         | Unauthenticated API calls                                                            |
| DynamoDB `ConditionExpression` | Spend-limit violations (see [spend-reservation](../data-model/spend-reservation.md)) |

The rest is on the engineer (or agent) to honor.

## Bypass mechanisms (use only when authorized)

- `AV_SKIP_PREPUSH=1 git push` — skip pre-push checks. Document in the PR why.
- `git commit --no-verify` — skip pre-commit + commit-msg. **Forbidden without explicit human authorization.**
