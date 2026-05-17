import { AgentId, RunId, z } from '@agent-village/shared';
import { runner, type ExecuteRunInput } from '@agent-village/services';
import { jsonResponse, withContext } from '../middleware.js';

const Body = z.object({
  dryRun: z.boolean().optional(),
  replayOfRunId: RunId.optional(),
});

export const handler = withContext(async (event) => {
  const agentId = AgentId.parse(event.pathParameters?.['id']);
  const body = Body.parse(JSON.parse(event.body ?? '{}'));
  const input: ExecuteRunInput = { agentId };
  if (body.dryRun !== undefined) input.dryRun = body.dryRun;
  if (body.replayOfRunId !== undefined) input.replayOfRunId = body.replayOfRunId;
  const result = await runner.executeRun(input);
  return jsonResponse(202, result);
});
