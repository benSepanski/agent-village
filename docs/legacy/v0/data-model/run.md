# Run entity

One row per agent execution (scheduled or manual). Append-only.

## Shape

| pk                | sk                           | gsi1pk              | gsi1sk               | attrs                                                                                                                                                          |
| ----------------- | ---------------------------- | ------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENT#<agentId>` | `RUN#<isoTimestamp>#<runId>` | `USER#<cognitoSub>` | `RUN#<isoTimestamp>` | `status`, `kind`, `costUsd`, `tokensIn`, `tokensOut`, `output`, `error`, `durationMs`, `traceId`, `model`, `systemPromptHash`, `dryRun`, `taskArn`, `exitCode` |

`kind` is `inline` (Phase-1 Anthropic call) or `sandbox` (Phase-2 Fargate run). `taskArn` and `exitCode` are populated for `sandbox` runs; `model`/`systemPromptHash` for `inline` runs.

## `status` enum

| Value                  | Meaning                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `ok`                   | Run succeeded; `output` populated (inline) or the sandbox task exited 0                 |
| `error`                | Anthropic call or the sandbox task failed; `error` populated                            |
| `spend_limit_exceeded` | Pre-run reservation failed; no run started                                              |
| `running`              | Sandbox task launched and in flight; moved to a terminal status by the lifecycle Lambda |
| `launch_failed`        | Sandbox `RunTask` (or its setup) failed before the task started; reservation refunded   |
| `timed_out`            | Sandbox task was stopped for exceeding `manifest.timeoutMinutes`                        |

## Access patterns

| What I want                                        | Operation                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| Latest 50 runs for an agent                        | `Query pk=AGENT#<id> begins_with(sk, "RUN#") Limit=50 ScanIndexForward=false` |
| All my runs across agents (for system-health view) | `Query gsi1pk=USER#<sub> begins_with(gsi1sk, "RUN#")`                         |
| One specific run                                   | `GetItem pk=AGENT#<id> sk=<full-sk>`                                          |

## traceId

Every run carries the X-Ray `traceId` used by the structured log events. The run-detail page in the UI uses this to render the per-step timeline and to deep-link CloudWatch Logs Insights.
