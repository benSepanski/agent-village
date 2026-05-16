# Playbook: experiment with an agent

You should never need to read source code to experiment with an agent.
This playbook lists every affordance for poking at one.

## In the UI

| Action                | Where                                                                                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Run now**           | Agent detail page → "Run now" button. Bypasses the schedule and invokes the runner immediately. Same code path as a scheduled run; not a separate "test mode".                                                              |
| **Dry run**           | Create / edit form → "Dry run" toggle. Caps `max_tokens` at 256 and marks the run record with `dryRun: true`. Use this to sanity-check a config without burning budget.                                                     |
| **Replay a past run** | Run detail page → "Replay" button. Re-runs with the _exact_ prompt + config snapshot stored on the original run. Great for A/B testing config tweaks.                                                                       |
| **Prompt scratchpad** | Agent detail page → "Scratchpad" tab. Edit the system prompt + a one-off user prompt, hit "Run", see result. Doesn't mutate the saved agent unless you click "Save to agent".                                               |
| **Pause / resume**    | Agent detail page → status toggle. Paused agents skip their schedule.                                                                                                                                                       |
| **Inspect a run**     | Run detail page shows the exact prompt sent, response received, per-step timeline derived from structured log events, token + cost breakdown, and a deep link to CloudWatch Logs Insights filtered to that run's `traceId`. |

## From the CLI

```bash
village agents list                  # paginated table
village agents show <agentId>        # full config + last 10 runs
village run <agentId>                # same as the UI "Run now" button
village logs <runId>                 # streams structured log events in order
village env doctor                   # local stack health check
```

The CLI uses the same auth (Cognito refresh token) as the UI. Tokens are
stored in `~/.config/agent-village/credentials`.

## Locally (no AWS account)

```bash
pnpm local:up                        # boot LocalStack + DynamoDB Local
pnpm doctor:local                    # confirm green
pnpm seed                            # demo user + agent + sample runs
pnpm dev                             # SPA at http://127.0.0.1:5173
```

The local scheduler tick runs every 10 seconds and triggers any agent
whose cron is due — see `tools/scripts/local-scheduler.ts`. All logs
stream to the terminal pretty-printed (same JSON shape as prod, just
colorized).

## Common knobs

| Setting         | Effect                                        | Where                           |
| --------------- | --------------------------------------------- | ------------------------------- |
| `spendLimitUsd` | Hard cap on monthly Anthropic spend per agent | Edit on the agent form          |
| `schedule`      | Cron expression in `EventBridge` format       | Edit on the agent form          |
| `model`         | Anthropic model identifier                    | Edit on the agent form          |
| `status`        | `active` runs on schedule, `paused` skips     | Toggle on the agent detail page |
| `LOG_LEVEL`     | Local-dev log verbosity (default `info`)      | `.env.local`                    |
