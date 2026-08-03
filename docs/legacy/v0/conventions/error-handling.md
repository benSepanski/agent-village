# Error handling

## Throw

- Throw `Error` (or a domain-specific subclass). Never throw strings, plain objects, or numbers.
- Domain-specific errors live in `packages/domain/src/errors.ts` (Phase 1) — they carry the data needed to render a useful HTTP response.

## Catch

- Catch at the layer boundary, not at the call site. Lower layers don't know what HTTP is.
- Translate the error into the layer's idiom. `domain` errors → HTTP status codes in `api/`. AWS SDK errors → domain errors in `data/`.

## Log

- Every caught error gets one structured log call whose `event` name ends in `.error` or `.failed`:

```ts
try {
  await thing();
} catch (err) {
  logger.error({ event: 'agent.run.failed', agentId, runId, err });
  throw err;
}
```

## Never

- **Never** swallow an error silently. If suppressing is intentional, log it with an event ending in `.suppressed` and a `reason` field.
- **Never** catch only to log and re-throw the same error with no added context. If you have nothing to add, don't catch.
