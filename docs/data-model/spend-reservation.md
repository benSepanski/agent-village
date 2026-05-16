# Spend reservation

The atomic pattern that prevents an agent from blowing past its `spendLimitUsd`.

## Sequence

1. **Estimate** the upcoming call's cost from `model` + `max_tokens` ceiling.
2. **Reserve** with a conditional `UpdateItem` on the Agent record:

   ```
   UpdateExpression:   ADD spendUsedUsd :estimated
   ConditionExpression: spendUsedUsd + :estimated <= spendLimitUsd
   ```

   If the condition fails → write a Run with `status=spend_limit_exceeded`, emit alarm metric, exit. No Anthropic call.

3. **Call** Anthropic.
4. **Finalize** with a second `UpdateItem` that corrects `spendUsedUsd` from the estimate to the actual usage-based cost:

   ```
   UpdateExpression: ADD spendUsedUsd :delta
   ```

   `:delta` may be negative (estimate was high) or zero. No condition — finalization always succeeds.

## Why two writes

Reserving prevents two concurrent runs from both passing the limit check and both calling Anthropic. The finalize keeps the accumulator honest after the fact.

The cost is one extra `UpdateItem` per run. DynamoDB pay-per-request makes that ~$0.000001.

## Failure modes

- **Reserve succeeds, Anthropic call throws before completing**: the estimate is held against the budget even though no Anthropic spend occurred. Acceptable — the next call will likely retry from the same agent and the estimate is small. A Phase 2+ reconciliation cron can sweep these.
- **Reserve succeeds, finalize fails** (DDB throttling, etc): the run record still writes with the actual cost in its `costUsd` attribute; the agent accumulator drifts up by `estimate - actual`. Same Phase 2+ cron sweeps these.

These edge cases are documented here so a future engineer sees them; they're acceptable at MVP scale.
