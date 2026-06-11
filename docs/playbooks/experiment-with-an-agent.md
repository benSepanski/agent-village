# Playbook: experiment with an agent

Every affordance for poking at an agent without reading source code.

## In the UI

| Action                | Where, and what actually happens                                                                                                                                                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Run now**           | Agent detail page → "Run now". Invokes the runner immediately via `POST /agents/:id/run-now` — the same code path as a scheduled run, not a separate test mode.                                                                                                                     |
| **Dry run**           | Checkbox next to "Run now" (and next to "Replay"). Caps `max_tokens` at 256 and marks the run `dryRun: true`; the Anthropic call still happens, just cheaply. See the constants in [`runner.ts`](../../packages/services/src/runner.ts).                                            |
| **Replay a past run** | Run detail page → "Replay". Re-runs the agent and records `replayOfRunId`. Guard: the agent's current system prompt must still hash to what the original run captured, otherwise the replay is rejected (`verifyReplay()` in [`runner.ts`](../../packages/services/src/runner.ts)). |
| **Prompt scratchpad** | Agent detail page, bottom section. Edit the system prompt and a one-off user prompt. **"Save to agent" works** (patches `systemPrompt`); the standalone scratchpad "Run" is not wired to a backend yet — it captures the prompt locally only.                                       |
| **Pause / resume**    | Agent detail page → Pause/Resume button. Sends `PATCH {status}`; paused agents skip their schedule.                                                                                                                                                                                 |
| **Spend position**    | The spend bar on the agent detail page shows `spendUsedUsd` against `spendLimitUsd`.                                                                                                                                                                                                |
| **Inspect a run**     | Run detail page: status, cost, token counts, output/error, a step timeline reconstructed from the run record, and a CloudWatch Logs Insights deep link for the run's `traceId`.                                                                                                     |

## From the CLI

The CLI talks to the deployed API; set `AV_API_URL` to the API endpoint first.

```bash
village agents list                    # table of my agents
village agents show <agentId>          # full config + recent runs
village run <agentId> [--dry-run]      # same as the UI "Run now"
village logs <agentId> <runId>         # detail/timeline for one run
village env doctor                     # local-environment diagnostics
```

Command definitions: [`cli/src/cli.ts`](../../packages/cli/src/cli.ts). Auth uses the same Cognito flow as the UI; the refresh token is stored in the OS keychain when available, falling back (with a printed security warning) to plaintext at `~/.config/agent-village/credentials`. `AV_ACCESS_TOKEN` short-circuits both — see [`cli/src/auth.ts`](../../packages/cli/src/auth.ts).

## Locally (no AWS account)

```bash
pnpm local:up                          # docker compose + LocalStack + DynamoDB Local + bootstrap
pnpm doctor:local                      # green/red status table
pnpm dev                               # SPA at http://127.0.0.1:5173
```

The bootstrap script ([`local-bootstrap.ts`](../../tools/scripts/local-bootstrap.ts)) creates the table and a demo secret. There is no local scheduler — schedules are an EventBridge Scheduler feature and only fire in deployed environments; trigger runs locally via the CLI or UI. Logs print pretty-printed locally and as JSON when deployed (same envelope, see [structured-logging](../conventions/structured-logging.md)).

## Common knobs

| Setting         | Effect                                                                                          | Where                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `spendLimitUsd` | Hard cap on the agent's cumulative Anthropic spend                                              | Agent form ([spend-reservation](../data-model/spend-reservation.md))                           |
| `schedule`      | 5-field cron (or EventBridge `cron(...)`/`rate(...)`); `null` = manual-only                     | Agent form; dialect conversion in [`scheduling.ts`](../../packages/services/src/scheduling.ts) |
| `model`         | Anthropic model id, one of the enum in [`agent.ts`](../../packages/shared/src/schemas/agent.ts) | Agent form                                                                                     |
| `status`        | `active` runs on schedule, `paused` skips                                                       | Pause/Resume on the agent detail page                                                          |
| `LOG_LEVEL`     | Logger verbosity (default `info`)                                                               | Env var, read by [`logger.ts`](../../packages/shared/src/observability/logger.ts)              |
