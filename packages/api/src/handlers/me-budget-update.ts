import { UpdateUserInput, UserId } from '@agent-village/shared';
import { budget } from '@agent-village/services';
import { jsonResponse, withContext } from '../middleware.js';

/**
 * Set, change, or clear the caller's live monthly budget cap.
 * `{ userMonthlyBudgetUsd: number }` sets it, `{ userMonthlyBudgetUsd: null }`
 * clears it. Takes effect on the caller's next spend reservation.
 */
export const handler = withContext(async (event, ctx) => {
  const ownerSub = UserId.parse(ctx.cognitoSub);
  const patch = UpdateUserInput.parse(JSON.parse(event.body ?? '{}'));
  const updated = await budget.updateUserBudget(ownerSub, patch);
  return jsonResponse(200, updated);
});
