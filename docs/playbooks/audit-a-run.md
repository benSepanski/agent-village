# Playbook: audit a run

Reconstruct a run's full story — who, what, when, cost, and outcome — using
only the system's own observability: the `Run` record in DynamoDB, structured
logs correlated by `traceId`, and (in a deployed env) CloudWatch. No source
access to the agent's own workspace or output is required beyond what the
`Run` record and logs already capture.

This playbook is split into what was **actually exercised against the local
stack** during M6 dogfooding, and what is **documented from
[observability](../architecture/observability.md) but only exercisable in a
deployed `dev`/`prod` environment** — the two are marked explicitly throughout,
because the local and deployed audit stories are materially different in this
milestone.

## The record you're reconstructing

A run is one `Run` item (schema:
[`packages/shared/src/schemas/run.ts`](../../packages/shared/src/schemas/run.ts)):

| Field                                                                                         | Answers                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `agentId`, `ownerSub`                                                                   | which run, which agent, **who** (the owner's Cognito sub)                                                                                                                                                                          |
| `createdAt`, `events[]`                                                                       | **when** — creation time plus an ordered lifecycle timeline (`agent.run.started` → `completed`/`failed`/`spend_rejected` for inline runs; `sandbox.run.launched` → `task_started` → `task_stopped` → `finalized` for sandbox runs) |
| `status`, `output`, `error`, `exitCode`                                                       | **outcome**                                                                                                                                                                                                                        |
| `costUsd`, `tokensIn`, `tokensOut`, `reservedUsd`, `budgetWindowKey`                          | **cost/reservation** — `budgetWindowKey` names the `BUDGET#YYYY-MM` window this run's spend was reserved against, if the owner had a monthly budget at reservation time                                                            |
| `traceId`                                                                                     | the correlation key into structured logs                                                                                                                                                                                           |
| `kind`, `model`, `systemPromptHash`, `dryRun`, `replayOfRunId`, `taskArn`, `gatewayTokenHash` | **what** — inline vs. sandbox, which model/prompt version, whether this was a dry run or a replay of an earlier run                                                                                                                |

Storage key (single-table DynamoDB, `pk`/`sk` + one GSI — see
[`packages/data/src/dynamo/keys.ts`](../../packages/data/src/dynamo/keys.ts) and
[`runs.ts`](../../packages/data/src/dynamo/runs.ts)):

- `pk = AGENT#<agentId>`, `sk = RUN#<createdAt>#<runId>` — query by agent, sorted
  by time, one call.
- `gsi1pk = USER#<ownerSub>`, `gsi1sk = RUN#<createdAt>` on index `gsi1` — the
  same record, queryable by **owner** instead of agent. This is the index an
  auditor starts from when the question is "what did this user do," not "what
  did this agent do."

## Locally — what was actually done, and what it found (M6 dogfood, 2026-07-21)

**Prerequisites:** `pnpm local:up` (LocalStack + DynamoDB Local + bootstrap),
`aws` CLI, `AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
AWS_DEFAULT_REGION=us-east-1` (LocalStack/DynamoDB Local accept any
non-empty static credentials).

1. **Find the DynamoDB table:**
   ```bash
   aws --endpoint-url=http://127.0.0.1:8000 dynamodb list-tables
   ```
2. **Look up runs for a known agent** (by `pk`) — _documented procedure, **not
   exercisable this session**: with `Count: 0` there was no `agentId` to bind, so
   this is a parameterized template, not a command that ran:_
   ```bash
   aws --endpoint-url=http://127.0.0.1:8000 dynamodb query \
     --table-name agent-village-local \
     --key-condition-expression "pk = :pk AND begins_with(sk, :prefix)" \
     --expression-attribute-values '{":pk":{"S":"AGENT#<agentId>"},":prefix":{"S":"RUN#"}}'
   ```
3. **Look up runs for a known owner** (by `gsi1pk`, the "who did what" index) —
   _same status: documented procedure, **not exercisable this session** (no
   `cognitoSub` to bind against an empty table):_
   ```bash
   aws --endpoint-url=http://127.0.0.1:8000 dynamodb query \
     --table-name agent-village-local --index-name gsi1 \
     --key-condition-expression "gsi1pk = :pk" \
     --expression-attribute-values '{":pk":{"S":"USER#<cognitoSub>"}}'
   ```
4. **Or, when you don't know an id yet, scan everything** (fine at local scale
   only — never do this against a deployed table):
   ```bash
   aws --endpoint-url=http://127.0.0.1:8000 dynamodb scan --table-name agent-village-local
   ```
5. **Correlate by `traceId`.** Locally there is no CloudWatch, so
   "structured logs from local api/runner processes" means: find the `pnpm
dev`/API/runner process's stdout, then `grep '"traceId":"<id>"'` across it —
   every line the shared logger emits carries `traceId` and `event` fields (see
   [structured-logging](../conventions/structured-logging.md) and
   [`middleware.ts`](../../packages/api/src/middleware.ts)'s
   `http.request.received`/`handled`/`error` triplet).

**What step 4/5 actually found this session:** a full unfiltered `scan` of
`agent-village-local` returned `{"Items": [], "Count": 0}`, and
`describe-table` confirmed `ItemCount: 0` — genuinely zero records, not a
query mistake (table schema itself is correct: `pk`/`sk` + `gsi1pk`/`gsi1sk`
exactly as designed). Step 5 found nothing to grep, because **no `api` or
`runner` process was ever running locally** — `pnpm dev` only starts the
`@agent-village/web` Vite dev server (`packages/api`, `packages/services`,
`packages/runner` have no `dev` script at all, and there is no `local.ts` in
`packages/infra/config/` — API Gateway + Lambda + the runner are purely
AWS-account concepts, not emulated locally). `docker logs agent-village-ddb`
showed only 9 startup-banner lines, no per-request logging (DynamoDB Local
doesn't log requests to stdout by default), consistent with the empty scan.

**Root-caused finding:** this isn't a broken audit mechanism — it's that the
local stack, as bootstrapped by `pnpm local:up` + `pnpm dev`, has **no
execution path** that can ever create a `Run` record: no API to accept `POST
/agents/:id/run-now`, no scheduler, no runner to execute it. Four other M6
dogfood personas independently hit the identical root cause from different
angles (CLI: "No API URL configured" → "No stored credentials" → "fetch
failed"; browser: stuck on the sign-in screen with no working local
auth path). The audit trail is empty because nothing ever ran, not because
anything ran and wasn't recorded. **Standing this up (a real local API/runner
emulation) is out of scope for a "trivial unblocking fix" and is M7
(dev-deployment) territory** — see
[experiment-with-an-agent.md](experiment-with-an-agent.md)'s own local
section, which correctly documents that runs must be triggered via the CLI
or UI, both of which require a deployed API.

**Bottom line for anyone repeating this locally today:** steps 1–5 above are
the real, correct procedure, and they will work the moment any run exists
locally (in particular, once M7 stands up a way to originate one) — but as of
this milestone there is nothing to reconstruct, and that emptiness is itself
the honest result of running the procedure, not a failure to find the right
commands.

## In a deployed environment (`dev`/`prod`) — documented, not exercised in this session

This section is written from
[`docs/architecture/observability.md`](../architecture/observability.md) and
the source it cites. It was **not run against a real deployment** in this
session — no `dev`/`prod` stack exists in this milestone's scope (M7).

1. **Start from the `traceId`.** Get it from the `Run` record (`GET
/agents/:id/runs/:runId` or the Run detail page, which links out to it), or
   from the API Gateway access log for the request that triggered the run.
2. **CloudWatch Logs Insights**, filtering on that `traceId` across the API
   and runner Lambda log groups, reconstructs the request→run timeline in one
   query — this is the documented purpose of propagating `traceId` end to end
   (API middleware reads `x-amzn-trace-id`; the runner reads Lambda's
   `_X_AMZN_TRACE_ID` env var). The `Run` record itself also persists
   `traceId`, so you can go trace→run or run→trace in either direction.
3. **Metrics.** Structured log lines may carry a `metric: { name: value }`
   payload (e.g. `spend.reserved_usd`, `run.cost_usd`, `run.duration_ms`,
   emitted in [`runner.ts`](../../packages/services/src/runner.ts)) — these
   are queryable via Logs Insights stats queries. Terminal run outcomes also
   emit a CloudWatch EMF envelope via
   [`runOutcomeMetric`](../../packages/shared/src/observability/emf.ts),
   feeding the custom `AgentVillage`-namespace alarms.
4. **Alarms** (defined in
   [`MonitoringStack`](../../packages/infra/src/stacks/monitoring-stack.ts)):
   runner Lambda errors, runner duration p95, `runs.error`, and
   `runs.spend_limit_exceeded` all publish to an SNS topic subscribed by the
   env's `alarmEmail` — a real incident starts here, then drills into Logs
   Insights by `traceId`.
5. **In-app surface**, for a first pass before touching CloudWatch at all: the
   agent detail page's run list, and the run detail page (token/cost
   breakdown, output/error, the `events[]` timeline rendered by
   [`RunTimeline.tsx`](../../packages/web/src/components/RunTimeline.tsx), and
   a CloudWatch Logs Insights deep link scoped to that run's `traceId`).

## Local vs. CloudWatch — the actual difference, as found this session

|                                | Local                                                                                                                          | Deployed (`dev`/`prod`)                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Run storage                    | Same DynamoDB single-table design, real DynamoDB Local — schema and query patterns identical                                   | Same table design, real DynamoDB                                                                                             |
| How you'd query it             | `aws --endpoint-url=http://127.0.0.1:8000 dynamodb query/scan` (exercised this session — see above)                            | Same `aws dynamodb query`, no `--endpoint-url`, or the in-app UI                                                             |
| Where structured logs live     | Nowhere — no api/runner process runs locally in this milestone's stack, so there is nothing to `grep` (confirmed this session) | CloudWatch Logs (API + runner Lambda log groups), JSON envelope, filterable by `traceId` in Logs Insights                    |
| Metrics/alarms                 | None locally                                                                                                                   | CloudWatch EMF custom metrics + native Lambda metrics, wired to SNS alarms                                                   |
| What actually originates a run | Nothing — no local API, scheduler, or runner (confirmed this session, matching four independent M6 personas)                   | EventBridge Scheduler → runner Lambda → (sandbox agents) ECS Fargate, per [sandbox-runs.md](../architecture/sandbox-runs.md) |

## Evidence

Raw commands and outputs for the local-stack findings above are recorded in
the M6 dogfood auditor evidence log (session-scoped scratchpad, not part of
this repo).
