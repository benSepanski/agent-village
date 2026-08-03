# M3 status — per-user monthly spend budgets

M3 per the [milestone plan](1.0-definition.md#milestone-plan-criteria-mapped):
**AC-2.1–2.5, AC-2.7, AC-2.8, AC-3.5.** Complete.

## What landed

1. **Per-user monthly budget on the profile** — `userMonthlyBudgetUsd` on the
   user schema ([`packages/shared/src/schemas/user.ts`](../../packages/shared/src/schemas/user.ts)),
   defaulted on profile creation (AC-3.5). Unset stays behavior-identical to
   pre-M3: no window check is applied.
2. **Month-windowed accumulator**, lazily created, UTC-keyed
   `USER#<sub>` / `BUDGET#<YYYY-MM>` items
   ([`packages/data/src/dynamo/budget-windows.ts`](../../packages/data/src/dynamo/budget-windows.ts)) —
   auto-resets purely by period keying, no cron (AC-2.3).
3. **Single atomic reserve** — every spend-reservation path (inline runner,
   sandbox launch, per-call metering gateway) checks the per-agent lifetime
   cap and the per-user window in **one** DynamoDB `TransactWrite`
   ([`packages/services/src/budget.ts`](../../packages/services/src/budget.ts),
   [`packages/services/src/gateway-budget.ts`](../../packages/services/src/gateway-budget.ts),
   [`packages/services/src/runner-spend.ts`](../../packages/services/src/runner-spend.ts)) —
   no read-modify-write race (AC-2.1, AC-2.2, AC-2.4). Reservations pin their
   window key at creation so month-boundary settlement/refund always lands on
   the window it reserved against, even if the run straddles a rollover.
4. **Drift-reconciliation job** (`budget-drift`, following the existing
   sweeper pattern) — recomputes counters from run records, reconciles the
   current **and** previous month, and emits an EMF drift metric with a
   report-only alarm
   ([`packages/services/src/budget-drift.ts`](../../packages/services/src/budget-drift.ts),
   [`packages/infra/src/stacks/budget-drift-lambda.ts`](../../packages/infra/src/stacks/budget-drift-lambda.ts)) (AC-2.5).
5. **Transparency** — `GET`/`PATCH /me/budget` API routes
   ([`packages/api/src/handlers/me-budget.ts`](../../packages/api/src/handlers/me-budget.ts),
   [`me-budget-update.ts`](../../packages/api/src/handlers/me-budget-update.ts)),
   `village budget` / `village budget set` CLI
   ([`packages/cli/src/commands/budget-show.ts`](../../packages/cli/src/commands/budget-show.ts),
   [`budget-set.ts`](../../packages/cli/src/commands/budget-set.ts)), and web
   spend-page components (`UserBudget.tsx`, `UserBudgetForm.tsx`) showing the
   user-window limit/used/remaining alongside per-agent figures (AC-2.7; the
   web surfacing lands ahead of its AC-2.6/M4 target since it shares the same
   API contract).
6. **AWS Budgets alert-vs-block documented honestly**, with a worked path to
   add AWS Budget actions for hard enforcement (AC-2.8) — see
   [architecture/cost-guards.md](../architecture/cost-guards.md).

## Adversarial verification (Opus) — findings and fixes

- **CRITICAL** — the new `/me/budget` routes were never registered in
  `api-stack`'s `HANDLERS` map, so the feature would have been unreachable
  end-to-end despite passing unit tests. Fixed
  ([`packages/infra/src/stacks/api-stack.ts`](../../packages/infra/src/stacks/api-stack.ts)),
  and synth tests now assert the routes exist
  ([`packages/infra/src/stacks/api-stack.test.ts`](../../packages/infra/src/stacks/api-stack.test.ts)).
- **MAJOR** — the gateway's reserve and settle paths could each re-resolve
  the effective budget independently and disagree mid-run. Fixed by
  threading a single `resolveCallBudget` result through both paths, with
  regression tests
  ([`packages/services/src/anthropic-gateway.ts`](../../packages/services/src/anthropic-gateway.ts),
  [`anthropic-gateway.test.ts`](../../packages/services/src/anthropic-gateway.test.ts)).
- **Minor** — a cross-rollover month label bug and a drift-job
  previous-month blind spot; both fixed (see item 3 and item 4 above).

## Suite status

772 tests green across all 16 packages; CDK synth clean.
