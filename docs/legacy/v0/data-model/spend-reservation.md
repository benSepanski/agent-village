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

- **Anthropic returns an error**: the error is caught inside the call, the run is recorded with `status=error` and zero tokens, and finalization subtracts the full estimate — the accumulator is unchanged net. See `callAnthropic()` in [`runner.ts`](../../packages/services/src/runner.ts).
- **Anything else throws before finalization** (secret fetch fails, etc.): `refundReservation()` releases the estimate with a negative delta. Only if that refund write itself fails does the accumulator drift upward — logged as `agent.run.spend_refund_failed`.
- **Finalize succeeds but the run-record write fails**: the spend is counted but no run row exists; the structured logs for the `traceId` are the audit trail.

Residual drift is possible only when a _second_ write fails after the first succeeded; there is no reconciliation job, so correcting drift means manually adjusting `spendUsedUsd`. Acceptable at current scale.
