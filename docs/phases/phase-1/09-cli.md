# Phase 1, Step 9 — CLI

The `village` CLI provides the same affordances as the UI for poking at agents from a terminal.

## Files to create

```
packages/cli/
├── bin/village.ts                  # entry point — wires up commander
└── src/
    ├── auth.ts                     # Cognito refresh-token loader (~/.config/agent-village/credentials)
    ├── commands/
    │   ├── agents-list.ts
    │   ├── agents-show.ts
    │   ├── run.ts                  # village run <agentId>
    │   ├── logs.ts                 # village logs <runId>
    │   └── doctor.ts               # village env doctor
    └── format.ts                   # kleur table helpers
```

## Behavior

- `village agents list` — calls `GET /agents` and prints a table.
- `village agents show <id>` — calls `GET /agents/{id}` and prints the agent + last 10 runs.
- `village run <agentId>` — calls `POST /agents/{id}/run-now`, prints the resulting Run.
- `village logs <runId>` — for now: queries DDB directly for the run, prints its timeline reconstructed from log events. (When CloudWatch Logs Insights becomes practical, switch to that.)
- `village env doctor` — local stack health check (already stubbed via `pnpm doctor:local`; CLI wraps it).

## Auth

Uses Cognito hosted-UI auth code → refresh token, stored at `~/.config/agent-village/credentials` with file mode 600. The CLI exchanges the refresh token for an access token on every command.

## Acceptance

- `pnpm --filter @agent-village/cli test` covers every command's happy path with mocked HTTP calls.
- `pnpm village agents list` from a fresh checkout, after `pnpm dev`, prints a table against LocalStack.

## Reference

- [experiment-with-an-agent playbook](../../playbooks/experiment-with-an-agent.md)
