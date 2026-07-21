/**
 * Shared upper bound for any single USD budget/spend-cap value a caller can
 * set (`Agent.spendLimitUsd`, `User.userMonthlyBudgetUsd`, and their
 * create/update/patch input schemas). Two independent problems this guards
 * against:
 *
 * - Without `.finite()`, `z.number()` alone accepts `Infinity` and `NaN`.
 *   `Infinity` round-trips through `JSON.stringify` as `null`
 *   (`JSON.stringify(Infinity) === 'null'`), which then fails re-parsing on
 *   the read side and silently corrupts a DynamoDB `UpdateExpression` write
 *   built from it. `.finite()` rejects both `Infinity` and `NaN` (Zod's plain
 *   `z.number()` does not reject `NaN`, since `typeof NaN === 'number'`).
 * - Without an explicit `.max()`, values up to `Number.MAX_VALUE` (~1.8e308 —
 *   finite, so `.finite()` alone does not catch it) still pass, which is
 *   nonsensical for a spend cap and can misbehave downstream (DynamoDB
 *   numeric precision, UI formatting, the cost-estimate arithmetic in
 *   `@agent-village/domain/cost.ts`).
 *
 * $10,000 is chosen as a cap far above any plausible per-agent or per-user
 * budget on this platform's cost-guard scale (see
 * docs/architecture/cost-guards.md — the *account-level* AWS Budgets alarm,
 * which covers ALL spend across every agent, is itself only $5 dev / $20
 * prod): the point of this constant is not "how much you might actually
 * spend," it's keeping a single malformed or malicious input from producing
 * an absurd number that still passes validation. Both `spendLimitUsd` and
 * `userMonthlyBudgetUsd` share this one constant so the two caps can never
 * drift out of sync with each other.
 */
export const MAX_BUDGET_USD = 10_000;
