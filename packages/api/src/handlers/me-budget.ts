import { UserId } from '@agent-village/shared';
import { budget } from '@agent-village/services';
import { jsonResponse, withContext } from '../middleware.js';

/**
 * The caller's current-month budget status: their live monthly cap, the
 * accumulated spend against it, and each of their agents' own spend figures.
 */
export const handler = withContext(async (_event, ctx) => {
  const ownerSub = UserId.parse(ctx.cognitoSub);
  const status = await budget.getBudgetStatus(ownerSub);
  return jsonResponse(200, status);
});
