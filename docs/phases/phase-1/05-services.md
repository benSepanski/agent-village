# Phase 1, Step 5 — Services (use cases)

Orchestrate domain + data. Handlers in `api/`, `runner/`, and `cli/` call into these — never reach past them.

## Files to create

```
packages/services/src/
├── user.ts             # ensureProfile(cognitoClaims)
├── agent.ts            # listMyAgents, getMyAgent, createAgent, updateAgent, deleteAgent
├── scheduling.ts       # upsertSchedule, removeSchedule  (wraps EventBridge Scheduler SDK)
├── runner.ts           # executeRun(agentId, { dryRun?, replayOfRunId? })
└── index.ts
```

## Notes per file

- **`agent.createAgent`** — stores secret first, writes agent record second; rolls back the secret on DDB failure.
- **`agent.updateAgent`** — if `schedule` changed, call `scheduling.upsertSchedule` before persisting the new schedule on the agent.
- **`agent.deleteAgent`** — remove the EventBridge schedule, delete the secret, delete the agent row. Runs are kept.
- **`runner.executeRun`** — the single source of truth for one agent execution. Used by:
  - EventBridge scheduled invocations.
  - HTTP `POST /agents/:id/run-now` (synchronous from the API).
  - `village run` CLI command.
  - "Replay" UI action (reuses the stored prompt + config).

  Sequence: load agent → reserve spend → fetch secret → call Anthropic → finalize spend → persist run. Each step gets a structured log event (see [structured-logging](../../conventions/structured-logging.md)).

## Acceptance

- `pnpm --filter @agent-village/services test` covers every method, ≥80% lines.
- All log calls use the closed-enum `event` envelope. `pnpm lint` green.
- `pnpm deps:check` shows `services` only depends on `shared`, `domain`, `data`.

## Reference

- [topology](../../architecture/topology.md)
- [spend-reservation](../../data-model/spend-reservation.md)
- [observability](../../architecture/observability.md)
