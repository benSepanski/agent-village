import { UserId } from '@agent-village/shared';
import { user } from '@agent-village/services';
import { jsonResponse, withContext } from '../middleware.js';

export const handler = withContext(async (_event, ctx) => {
  const cognitoSub = UserId.parse(ctx.cognitoSub);
  const profile = await user.ensureProfile({
    sub: cognitoSub,
    email: ctx.email,
    ...(ctx.name ? { name: ctx.name } : {}),
  });
  return jsonResponse(200, profile);
});
