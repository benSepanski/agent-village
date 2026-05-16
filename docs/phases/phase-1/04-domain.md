# Phase 1, Step 4 — Domain helpers

Pure functions and typed errors. **No I/O.**

## Files to create

```
packages/domain/src/
├── errors.ts           # SpendLimitExceededError, AgentNotFoundError, InvalidScheduleError
├── schedule.ts         # validateCron(expr): string | null  — returns normalized expression or null
├── cost.ts             # estimateCost(model, maxTokens), actualCost(model, usage)
├── prompt.ts           # hashSystemPrompt(prompt): string
└── index.ts
```

## Constraints

- `errors.ts` exports concrete `Error` subclasses with `name`, `message`, and the data needed to render an HTTP response (`statusCode` getter, optional `details`).
- `cost.ts` carries the model-pricing table. When a new model is supported, add it here.
- `schedule.ts` accepts any EventBridge cron-expression syntax; reject anything else with `InvalidScheduleError`.

## Tests

≥80% line coverage; this layer is pure so testing is cheap.

## Acceptance

- `pnpm --filter @agent-village/domain test` covers every export.
- `pnpm deps:check` confirms `domain` only depends on `shared`.

## Reference

- [error-handling](../../conventions/error-handling.md)
