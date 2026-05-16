# Run entity

One row per agent execution (scheduled or manual). Append-only.

## Shape

| pk                | sk                           | gsi1pk              | gsi1sk               | attrs                                                                                                                           |
| ----------------- | ---------------------------- | ------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `AGENT#<agentId>` | `RUN#<isoTimestamp>#<runId>` | `USER#<cognitoSub>` | `RUN#<isoTimestamp>` | `status`, `costUsd`, `tokensIn`, `tokensOut`, `output`, `error`, `durationMs`, `traceId`, `model`, `systemPromptHash`, `dryRun` |

## `status` enum

| Value                  | Meaning                                             |
| ---------------------- | --------------------------------------------------- |
| `ok`                   | Anthropic call succeeded; `output` populated        |
| `error`                | Anthropic call or runtime failed; `error` populated |
| `spend_limit_exceeded` | Pre-call reservation failed; no Anthropic call made |

## Access patterns

| What I want                                        | Operation                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| Latest 50 runs for an agent                        | `Query pk=AGENT#<id> begins_with(sk, "RUN#") Limit=50 ScanIndexForward=false` |
| All my runs across agents (for system-health view) | `Query gsi1pk=USER#<sub> begins_with(gsi1sk, "RUN#")`                         |
| One specific run                                   | `GetItem pk=AGENT#<id> sk=<full-sk>`                                          |

## traceId

Every run carries the X-Ray `traceId` used by the structured log events. The run-detail page in the UI uses this to render the per-step timeline and to deep-link CloudWatch Logs Insights.
