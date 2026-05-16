# Agent entity

One row per agent. Owned by exactly one User.

## Shape

| pk                  | sk                | gsi1pk            | gsi1sk | attrs                                                                                                        |
| ------------------- | ----------------- | ----------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| `USER#<cognitoSub>` | `AGENT#<agentId>` | `AGENT#<agentId>` | `META` | `name`, `model`, `systemPrompt`, `schedule`, `spendLimitUsd`, `spendUsedUsd`, `anthropicSecretArn`, `status` |

## Attributes

| Attribute            | Notes                                                                |
| -------------------- | -------------------------------------------------------------------- |
| `name`               | Display name, max 80 chars                                           |
| `model`              | Anthropic model id (e.g. `claude-opus-4-7`)                          |
| `systemPrompt`       | The agent's persistent system prompt                                 |
| `schedule`           | EventBridge cron expression or `null` for manual-only                |
| `spendLimitUsd`      | Hard ceiling per `spendUsedUsd` accumulator                          |
| `spendUsedUsd`       | Running total, reset by a separate cron in Phase 2+                  |
| `anthropicSecretArn` | Secrets Manager ARN holding the API key (plaintext key never in DDB) |
| `status`             | `active` runs on schedule, `paused` skips                            |

## Access patterns

| What I want                                           | Operation                                           |
| ----------------------------------------------------- | --------------------------------------------------- |
| List my agents                                        | `Query pk=USER#<sub> AND begins_with(sk, "AGENT#")` |
| Get one of my agents                                  | `GetItem pk=USER#<sub> sk=AGENT#<id>`               |
| Get an agent by id (from the runner, no user context) | `Query gsi1pk=AGENT#<id>`                           |
| Atomically reserve spend                              | See [spend-reservation](spend-reservation.md)       |

## Lifecycle

- Created by `POST /agents` after writing the secret to Secrets Manager.
- Updated via `PATCH /agents/:id`. Schedule changes call EventBridge Scheduler to upsert the per-agent schedule.
- Deletion (`DELETE /agents/:id`) also deletes the schedule and the secret. Runs are kept (see [run-retention](run-retention.md)).
