# Pre-M7 punch-list status

Closes the four **pre-M7 fix** items from the M6 [1.0 verdict](1.0-verdict.md)
punch list ([PR #33](https://github.com/benSepanski/agent-village/pull/33)) —
the last gate before the M7 user-gated dev-AWS deploy (AC-7.5). This is not a
milestone; it's the punch-list branch the verdict called for before that
deploy happens.

## The four fixes

| #   | Punch-list item                                                                                                                                                                                   | Fix                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Finding E (MED)** — `RunNowSection` and the budget-edit mutation used `onSuccess` only, never surfacing a 402 spend/budget rejection on the two flows a spend-limit victim actually hits.       | Both now render `{mutation.error ? <p role="alert">…</p> : null}`, the same idiom already used on `agents.new.tsx`, `RunLogs.tsx`, `RunDetail.tsx`, `AgentForm.tsx`. `agents.$agentId.tsx`                                                                        |
| 3   | **Finding C (MED)** — `z.number().positive()` on `spendLimitUsd` / `userMonthlyBudgetUsd` accepted `Infinity` (round-trips to `null` over JSON, corrupts DynamoDB writes) and had no upper bound. | New shared `MAX_BUDGET_USD = 10_000` constant; both fields now `.positive().finite().max(MAX_BUDGET_USD)`. `spend-limits.ts` (new), `user.ts`, `agent.ts`                                                                                                         |
| 4   | **Finding F (MED)** — zero E2E coverage of the spend-transparency UI (`UserBudget`, `UserBudgetForm`, `SpendBar`, `/me/budget`) despite full mock-API fixture support.                            | New `e2e/spend.spec.ts` against the mocked-auth tier; mock fixtures extended with a stateful budget cap + accumulated spend so PATCH/GET `/me/budget` round-trip realistically. `spend.spec.ts` (new), `mock-api-state.ts`, `mock-api-routes.ts`, `e2e/README.md` |
| 14  | **AC-1.1 (LOW)** — no integration test asserted per-request `traceId` propagation; the "M2 integration coverage" claim was unbacked.                                                              | New `describe` block in `runner.test.ts` asserting every structured log line across a run's lifecycle (happy path and the `agent.run.failed` error leg) shares one `traceId` and a real event name.                                                               |

Punch-list items #2, #5–8, #12 are out of scope here — they are NEEDS-LIVE
(only verifiable on the M7 dev deploy) or lower-priority DX/doc items, not
pre-M7-fix blockers.

## Verifier outcome

Full suite, run clean from this branch (`export
PATH=~/.nvm/versions/node/v22.19.0/bin:$PATH` first):

| Check                      | Result                                                                                                                                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`        | ✅ pass                                                                                                                                                                                                                                                          |
| `pnpm lint`                | ✅ pass                                                                                                                                                                                                                                                          |
| `pnpm typecheck`           | ✅ pass (16/16 tasks)                                                                                                                                                                                                                                            |
| `pnpm test` (all packages) | ✅ pass — 16/16 tasks, every suite green, including the two new/changed suites: `shared` 130 tests (incl. new `spend-limits.test.ts`), `web` 67 tests (incl. new `agents.$agentId.test.tsx`), `services` 251 tests (incl. the new AC-1.1 `runner.test.ts` block) |

`e2e/spend.spec.ts` runs under the mocked-auth Playwright tier (no live AWS
required, per `e2e/README.md`'s tier table) alongside `smoke.spec.ts` and
`mvp.spec.ts`.

## Next: M7

User-gated dev-AWS deploy + live persona dogfood (AC-7.5), per the
[1.0 verdict](1.0-verdict.md)'s recommendation to land these four fixes first.
