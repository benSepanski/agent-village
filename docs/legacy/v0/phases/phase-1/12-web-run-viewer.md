# Phase 1, Step 12 — Web run viewer + experimentation

The observability + experimentation surface. **This is the single most important UI in the MVP.**

## Files to create

```
packages/web/src/
├── routes/
│   ├── agents.$agentId.runs.$runId.tsx   # /agents/$agentId/runs/$runId
│   └── health.tsx                        # /health
├── components/
│   ├── RunHistoryTable.tsx               # last 50 runs on agent detail page
│   ├── RunDetail.tsx                     # full run record
│   ├── RunTimeline.tsx                   # per-step timeline from log events
│   ├── PromptScratchpad.tsx              # one-off prompt experimentation
│   ├── RunControls.tsx                   # Run now / Dry run / Replay buttons
│   └── SystemHealth.tsx                  # spend vs Budget, error counts
```

## Run timeline

Reconstructs the run's lifecycle by fetching log events grouped by `traceId`. The Run record carries the `traceId`; the API exposes `GET /agents/{id}/runs/{runId}/events` that pulls structured log events from CloudWatch Logs Insights filtered by `traceId`.

Display each event as a row: timestamp, event name, key/value table of the payload. Highlight `agent.run.failed` and `agent.run.spend_rejected` in red.

## Experimentation controls

- **Run now** — calls `POST /agents/{id}/run-now`. Immediately navigates to the new Run's detail page.
- **Dry run** — toggle on the create / edit form AND on the Run-now button. When set, the run uses `dryRun: true` and caps `max_tokens` at 256.
- **Replay** — button on any Run detail page; calls `POST /agents/{id}/run-now` with `{ replayOfRunId }`. The runner reuses the stored prompt + config snapshot from the original run.
- **Prompt scratchpad** — separate tab on the agent detail page. Edit a one-off system prompt + user prompt, hit "Run", see result. Does not mutate the saved agent until "Save to agent" is clicked.

## CloudWatch deep link

The Run detail page renders a link that opens CloudWatch Logs Insights filtered to that run's `traceId`. The URL is built from the env's log group name + a hardcoded Insights query template.

## Acceptance

- All four experimentation affordances work end-to-end against dev.
- `pnpm --filter @agent-village/web test` covers `RunTimeline`, `PromptScratchpad`, `RunControls`.

## Reference

- [observability](../../architecture/observability.md)
- [experiment-with-an-agent playbook](../../playbooks/experiment-with-an-agent.md)
