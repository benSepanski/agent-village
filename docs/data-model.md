# Data model — DynamoDB single-table

One table per environment: `agent-village-{env}`. Single-table design.

## Keys

| Key      | Type           | Notes             |
| -------- | -------------- | ----------------- |
| `pk`     | string (HASH)  | Primary partition |
| `sk`     | string (RANGE) | Primary sort      |
| `gsi1pk` | string (HASH)  | GSI partition     |
| `gsi1sk` | string (RANGE) | GSI sort          |

GSI is named `gsi1`, projects ALL.

## Entities

### User

| pk                  | sk        | gsi1pk | gsi1sk | attrs                               |
| ------------------- | --------- | ------ | ------ | ----------------------------------- |
| `USER#<cognitoSub>` | `PROFILE` | —      | —      | `email`, `createdAt`, `displayName` |

Access pattern: get my profile by Cognito sub.

### Agent

| pk                  | sk                | gsi1pk            | gsi1sk | attrs                                                                                                        |
| ------------------- | ----------------- | ----------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| `USER#<cognitoSub>` | `AGENT#<agentId>` | `AGENT#<agentId>` | `META` | `name`, `spendLimitUsd`, `spendUsedUsd`, `schedule`, `anthropicSecretArn`, `status`, `model`, `systemPrompt` |

Access patterns:

- List my agents: `Query pk=USER#<sub> AND begins_with(sk, "AGENT#")`
- Get one agent: `GetItem pk=USER#<sub> sk=AGENT#<id>`
- Get an agent by id (without owner context, e.g. from the runner): `Query gsi1pk=AGENT#<id>`

### Run

| pk                | sk                           | gsi1pk              | gsi1sk               | attrs                                                                                                                           |
| ----------------- | ---------------------------- | ------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `AGENT#<agentId>` | `RUN#<isoTimestamp>#<runId>` | `USER#<cognitoSub>` | `RUN#<isoTimestamp>` | `status`, `costUsd`, `tokensIn`, `tokensOut`, `output`, `error`, `durationMs`, `traceId`, `model`, `systemPromptHash`, `dryRun` |

Access patterns:

- Latest runs for an agent: `Query pk=AGENT#<id> begins_with(sk, "RUN#") ScanIndexForward=false`
- All my runs across agents (for the system health view): `Query gsi1pk=USER#<sub> begins_with(gsi1sk, "RUN#")`

## Spend reservation pattern

The runner uses an atomic conditional `UpdateItem` on the Agent record before
calling Anthropic:

```
UpdateExpression: ADD spendUsedUsd :estimatedCost
ConditionExpression: spendUsedUsd + :estimatedCost <= spendLimitUsd
```

If the condition fails, the agent's spend limit is exhausted and the run is
recorded as `status=spend_limit_exceeded` without calling Anthropic.

After a successful Anthropic call, a second `UpdateItem` corrects
`spendUsedUsd` to the actual cost (estimated → actual delta).

## Run record retention

- Output and error fields are stored inline up to a per-env size cap (10 KB
  dev / 4 KB prod). Anything larger is truncated with a marker and the full
  body is written to `s3://agent-village-{env}-runs/<runId>.json`.
- Run records are not deleted automatically in Phase 1. Retention policies
  land in Phase 8.

## Item shapes are typed

All entities are defined as Zod schemas in
[`packages/shared/src/schemas/`](../packages/shared/src/schemas/). The
repositories in [`packages/data/src/dynamo/`](../packages/data/src/dynamo/)
parse on read and validate on write — the wire format and the TS types
cannot drift.
