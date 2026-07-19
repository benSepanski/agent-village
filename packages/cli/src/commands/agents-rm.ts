import { client } from '../client.js';
import { kv } from '../format.js';
import { promptText } from '../prompt.js';

export interface AgentsRmOptions {
  yes?: boolean | undefined;
  /** Test seam: overrides process.stdin.isTTY. */
  isTTY?: boolean | undefined;
  /** Test seam: overrides the confirmation prompt (defaults to a raw-TTY promptText). */
  confirmPrompt?: ((question: string) => Promise<string>) | undefined;
}

function isYes(answer: string): boolean {
  return /^y(es)?$/i.test(answer.trim());
}

async function confirmed(agentId: string, opts: AgentsRmOptions): Promise<boolean> {
  if (opts.yes) return true;
  const isTTY = opts.isTTY ?? Boolean(process.stdin.isTTY);
  if (!isTTY) {
    throw new Error(`Refusing to delete agent ${agentId} on a non-TTY without --yes`);
  }
  const prompt = opts.confirmPrompt ?? promptText;
  const answer = await prompt(`delete agent ${agentId}? [y/N] `);
  return isYes(answer);
}

/** DELETE /agents/{id} after a TTY confirmation (or --yes). */
export async function agentsRm(agentId: string, opts: AgentsRmOptions = {}): Promise<string> {
  const ok = await confirmed(agentId, opts);
  if (!ok) {
    return kv([
      ['agentId', agentId],
      ['action', 'cancelled'],
    ]);
  }
  const c = await client();
  await c.del(`/agents/${agentId}`);
  return kv([
    ['agentId', agentId],
    ['action', 'deleted'],
  ]);
}
