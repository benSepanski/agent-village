import { readFile } from 'node:fs/promises';
import { client } from '../client.js';
import { kv } from '../format.js';

export interface SecretsSetOptions {
  /** Inline value — prefer --from-file or stdin to keep it out of shell history. */
  value?: string | undefined;
  /** Read the value from this file. */
  fromFile?: string | undefined;
  /** Test seam: stdin source; defaults to process.stdin. */
  stdin?: NodeJS.ReadableStream | undefined;
}

interface StoredSecret {
  name: string;
  arn: string;
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/** One trailing newline (editor/echo artifact) is stripped; inner content is kept verbatim. */
async function resolveValue(opts: SecretsSetOptions): Promise<string> {
  if (opts.value !== undefined && opts.fromFile !== undefined) {
    throw new Error('Provide either --value or --from-file, not both');
  }
  if (opts.value !== undefined) return opts.value;
  const raw =
    opts.fromFile !== undefined
      ? await readFile(opts.fromFile, 'utf8')
      : await readStream(opts.stdin ?? process.stdin);
  return raw.replace(/\r?\n$/, '');
}

/** Store one secret value. The value is never echoed — output is names/ARNs only. */
export async function secretsSet(
  agentId: string,
  name: string,
  opts: SecretsSetOptions = {},
): Promise<string> {
  const value = await resolveValue(opts);
  if (value.length === 0) throw new Error('secret value is empty');
  const c = await client();
  const stored = await c.post<StoredSecret>(`/agents/${agentId}/secrets`, { name, value });
  return kv([
    ['agentId', agentId],
    ['secret', stored.name],
    ['arn', stored.arn],
    ['action', 'stored'],
  ]);
}
