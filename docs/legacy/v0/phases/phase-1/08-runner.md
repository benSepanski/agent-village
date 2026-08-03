# Phase 1, Step 8 — Runner handler

The Lambda EventBridge Scheduler invokes. Thin wrapper around `services.runner.executeRun`.

## File to create

```
packages/runner/src/handler.ts
```

## Behavior

1. Parse the event payload (`{ agentId: string }`) through a Zod schema from `@agent-village/shared`.
2. Call `services.runner.executeRun(agentId, {})`.
3. Return the Run id and status.

All real logic — load, reserve, fetch secret, call Anthropic, finalize, persist — lives in `services.runner.executeRun` (Step 5). The handler exists only to bridge from "AWS event" to "use case call".

## Logging

Every step emits a structured log event with the run's `traceId`. The closed-enum names live in `packages/shared/src/observability/events.ts` — they're already in place from Phase 0. Use them; don't invent new ones unless you also add them to the enum.

## Tests

- One test that mocks `services.runner.executeRun` and asserts the handler returns `{ runId, status }` on success.
- One test that asserts a bad event payload (missing `agentId`) returns a 400-shaped error and logs `agent.run.failed`.

## Acceptance

- `pnpm --filter @agent-village/runner test` green.
- `pnpm lint` green — the custom Zod-on-handlers rule is satisfied.

## Reference

- [services step](05-services.md)
- [observability](../../architecture/observability.md)
