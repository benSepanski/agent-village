# Key property: where agent state is persisted

**The property:** all durable state lives in exactly two stores — one DynamoDB table per environment for records, and one versioned S3 bucket for sandbox filesystem workspaces — plus Secrets Manager for API keys. Nothing durable lives on compute.

## Records — DynamoDB single table

One table per env, named `agent-village-{env}`, pay-per-request, with one GSI ([`data-stack.ts`](../../packages/infra/src/stacks/data-stack.ts)). Key layout and entity shapes: [data-model](../data-model/README.md).

| What                                                                                                                                                                                                                       | Written by | Code                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User profile (`USER#<sub>` / `PROFILE`) — created on first authenticated request                                                                                                                                           | API        | [`dynamo/users.ts`](../../packages/data/src/dynamo/users.ts), [`services/user.ts`](../../packages/services/src/user.ts)                                 |
| Agent config (`USER#<sub>` / `AGENT#<id>`) — name, model, system prompt, schedule, spend cap/accumulator, secret ARN, status                                                                                               | API        | [`dynamo/agents.ts`](../../packages/data/src/dynamo/agents.ts), [`services/agent.ts`](../../packages/services/src/agent.ts)                             |
| Run record (`AGENT#<id>` / `RUN#<ts>#<runId>`) — status, cost, tokens, output, error, traceId, prompt hash. **Append-only**: writes use `ConditionExpression: attribute_not_exists(pk)`, so a run can never be overwritten | runner     | [`append()` in `dynamo/runs.ts`](../../packages/data/src/dynamo/runs.ts), built in [`buildRun()` in `runner.ts`](../../packages/services/src/runner.ts) |

Run `output` is stored inline on the item as a nullable string; there is no S3 overflow path for large outputs. Retention behavior: [run-retention](../data-model/run-retention.md).

## Secrets — Secrets Manager

One secret per agent at `agent-village/{env}/agents/{agentId}/anthropic-key` ([`secrets/anthropic.ts`](../../packages/data/src/secrets/anthropic.ts)). The agent record stores only the ARN; the plaintext key is fetched per run and never persisted in DynamoDB. Deleting an agent deletes its secret ([`services/agent.ts`](../../packages/services/src/agent.ts)).

## Sandbox workspaces — versioned S3

For containerized application runs (ADR [0002](../adr/0002-fargate-sandbox-runs.md)), each (user, agent) pair owns the prefix `{ownerSub}/{agentId}/` in the workspace bucket:

- Bucket: versioned, encrypted, lifecycle-expires noncurrent versions (30 d dev / 90 d prod) — [`buildWorkspaceBucket()` in `sandbox-stack.ts`](../../packages/infra/src/stacks/sandbox-stack.ts).
- Prefix helper: [`workspacePrefix()` in shared](../../packages/shared/src/schemas/manifest.ts).
- The base-image entrypoint syncs the prefix down to `/workspace` before the app starts, flushes on an interval, and syncs back up on exit/failure/SIGTERM — [`sandbox-image/entrypoint.sh`](../../packages/infra/sandbox-image/entrypoint.sh).

## Durability per environment

- **prod:** DynamoDB PITR enabled (35-day point-in-time restore); `RemovalPolicy.RETAIN` on the table, web bucket, and workspace bucket — `cdk destroy` leaves data intact.
- **dev:** no PITR, `RemovalPolicy.DESTROY` with auto-delete — data is ephemeral by design.

Both knobs come from `retainOnDelete` / `env` in [`config/`](../../packages/infra/config/).

## Known limits

- Lambda memory and Fargate task disks are scratch space; anything not written to DynamoDB or synced to S3 is lost when the invocation/task ends.
- A hard-killed sandbox task loses writes since the last flush; `flushIntervalSeconds` in the [`ApplicationManifest`](../../packages/shared/src/schemas/manifest.ts) bounds the window.
