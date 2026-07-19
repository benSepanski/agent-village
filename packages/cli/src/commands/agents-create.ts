import { CreateAgentInput } from '@agent-village/shared';
import type { CreateAgentInput as CreateAgentInputType } from '@agent-village/shared';
import { client } from '../client.js';
import { kv } from '../format.js';
import { readJsonFile } from './read-input.js';
import { formatZodError } from './zod-errors.js';

export interface AgentsCreateOptions {
  file: string;
  /** Test seam: stdin source when file is '-'; defaults to process.stdin. */
  stdin?: NodeJS.ReadableStream | undefined;
}

interface CreatedAgent {
  id: string;
  name: string;
}

function parseInput(raw: unknown): CreateAgentInputType {
  const result = CreateAgentInput.safeParse(raw);
  if (!result.success) throw new Error(formatZodError(result.error));
  return result.data;
}

/** Parse CreateAgentInput locally (fail fast, no round trip for a bad payload) then POST /agents. */
export async function agentsCreate(opts: AgentsCreateOptions): Promise<string> {
  const raw = await readJsonFile(opts.file, opts.stdin);
  const input = parseInput(raw);
  const c = await client();
  const created = await c.post<CreatedAgent>('/agents', input);
  return kv([
    ['id', created.id],
    ['name', created.name],
    ['action', 'created'],
  ]);
}
