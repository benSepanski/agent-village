import { z } from 'zod';
import { UserId } from './ids.js';
import { MAX_BUDGET_USD } from './spend-limits.js';

export const UserSchema = z.object({
  cognitoSub: UserId,
  email: z.string().email(),
  displayName: z.string().min(1).max(120),
  // Unset = no user-level monthly cap (preserves current behavior). Never
  // negative/zero — a budget of $0 would mean "never spend," which is
  // expressed by simply not setting the field. `.finite()` + `.max()` reject
  // Infinity/NaN and cap the value — see spend-limits.ts.
  userMonthlyBudgetUsd: z.number().positive().finite().max(MAX_BUDGET_USD).optional(),
  createdAt: z.string().datetime(),
});
export type User = z.infer<typeof UserSchema>;

/**
 * PATCH /me body. Nullable (not just optional) so the client can explicitly
 * CLEAR the cap: `{ userMonthlyBudgetUsd: null }` maps to a DynamoDB REMOVE,
 * while omitting the key entirely leaves the existing cap untouched.
 */
export const UpdateUserInput = z
  .object({
    userMonthlyBudgetUsd: z.number().positive().finite().max(MAX_BUDGET_USD).nullable(),
  })
  .partial();
export type UpdateUserInput = z.infer<typeof UpdateUserInput>;

/**
 * Persisted BUDGET#<month> window item: pk=USER#<sub>, sk=BUDGET#<YYYY-MM>
 * (UTC), lazily upserted on the first reservation of the month. `spentUsd` is
 * a plain number — NOT `.nonnegative()` — because an unconditional refund ADD
 * (finalizeSpend) can momentarily push it slightly below zero under drift,
 * and the item must still parse on read. Read surfaces clamp the displayed
 * `used` at 0. `budgetLimitUsd` is a last-written snapshot for observability
 * only; the live cap for enforcement always comes from the PROFILE item.
 */
export const UserBudgetWindowSchema = z.object({
  ownerSub: UserId,
  month: z.string().regex(/^\d{4}-\d{2}$/),
  spentUsd: z.number(),
  budgetLimitUsd: z.number().positive(),
  updatedAt: z.string().datetime(),
});
export type UserBudgetWindow = z.infer<typeof UserBudgetWindowSchema>;
