import { UpdateAgentInput } from '@agent-village/shared';
import type { UpdateAgentInput as UpdateAgentInputType } from '@agent-village/shared';
import { client } from '../client.js';
import { kv } from '../format.js';
import { readJsonFile } from './read-input.js';
import { formatZodError } from './zod-errors.js';

export interface AgentsUpdateOptions {
  file: string;
  /** Test seam: stdin source when file is '-'; defaults to process.stdin. */
  stdin?: NodeJS.ReadableStream | undefined;
}

interface UpdatedAgent {
  id: string;
  name: string;
}

function parseInput(raw: unknown): UpdateAgentInputType {
  const result = UpdateAgentInput.safeParse(raw);
  if (!result.success) throw new Error(formatZodError(result.error));
  return result.data;
}

/** Parse UpdateAgentInput locally (fail fast) then PATCH /agents/{id}. */
export async function agentsUpdate(agentId: string, opts: AgentsUpdateOptions): Promise<string> {
  const raw = await readJsonFile(opts.file, opts.stdin);
  const input = parseInput(raw);
  const c = await client();
  const updated = await c.patch<UpdatedAgent>(`/agents/${agentId}`, input);
  return kv([
    ['id', updated.id],
    ['name', updated.name],
    ['action', 'updated'],
  ]);
}
