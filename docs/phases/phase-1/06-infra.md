# Phase 1, Step 6 — Infra wiring

Bring the placeholder CDK stacks to life.

## Stacks to flesh out

### `ApiStack` ([`packages/infra/src/stacks/api-stack.ts`](../../../packages/infra/src/stacks/api-stack.ts))

- `NodejsFunction` per HTTP handler from `packages/api/src/handlers/`.
- One API Gateway HTTP API with a JWT authorizer wired to the `AuthStack` Cognito User Pool.
- Routes:
  - `GET /me`
  - `GET /agents`
  - `POST /agents`
  - `GET /agents/{id}`
  - `PATCH /agents/{id}`
  - `DELETE /agents/{id}`
  - `POST /agents/{id}/run-now`
  - `GET /agents/{id}/runs`
  - `GET /agents/{id}/runs/{runId}`
- Each Lambda gets least-privilege IAM: DDB on `Table`, Secrets Manager on its own ARN pattern, EventBridge Scheduler `CreateSchedule | UpdateSchedule | DeleteSchedule` for the routes that need it.

### `RunnerStack` ([`packages/infra/src/stacks/runner-stack.ts`](../../../packages/infra/src/stacks/runner-stack.ts))

- One `NodejsFunction` for `packages/runner/src/handler.ts`.
- An EventBridge Scheduler group named `<prefix>-agents` — schedules are created/updated per-agent at runtime by `services/scheduling`.
- The runner Lambda's IAM: DDB on `Table`, Secrets Manager `GetSecretValue` on `agent-village/<env>/agents/*/anthropic-key`, CloudWatch metrics.

### `WebStack`

Already exists; add a deployment step that uploads `packages/web/dist` to the S3 bucket and invalidates CloudFront. Use `BucketDeployment`.

## Acceptance

- `pnpm --filter @agent-village/infra synth:dev` and `synth:prod` both succeed with cdk-nag clean (or documented suppressions).
- A Phase-1 `e2e` deploy to a sandbox AWS account works (manual verification).
- `pnpm typecheck` green.

## Reference

- [add-lambda playbook](../../playbooks/add-lambda.md)
- [deploy-env playbook](../../playbooks/deploy-env.md)
