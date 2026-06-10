import { AgentId, RunId, UserId, z } from '@agent-village/shared';
import { runner, type ExecuteRunInput } from '@agent-village/services';
import { jsonResponse, withContext } from '../middleware.js';

const Body = z.object({
  dryRun: z.boolean().optional(),
  replayOfRunId: RunId.optional(),
});

export const handler = withContext(async (event, ctx) => {
  const ownerSub = UserId.parse(ctx.cognitoSub);
  const agentId = AgentId.parse(event.pathParameters?.['id']);
  const body = Body.parse(JSON.parse(event.body ?? '{}'));
  // ownerSub scopes the agent load so callers can only run their own agents.
  const input: ExecuteRunInput = { agentId, ownerSub };
  if (body.dryRun !== undefined) input.dryRun = body.dryRun;
  if (body.replayOfRunId !== undefined) input.replayOfRunId = body.replayOfRunId;
  const result = await runner.executeRun(input);
  return jsonResponse(202, result);
});
