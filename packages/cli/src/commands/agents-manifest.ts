import { readFile } from 'node:fs/promises';
import { ApplicationManifest } from '@agent-village/shared';
import type { ApplicationManifest as ApplicationManifestType } from '@agent-village/shared';
import { client } from '../client.js';
import { kv } from '../format.js';

export interface AgentsManifestOptions {
  manifestPath?: string | undefined;
  detach?: boolean | undefined;
}

interface PatchedAgent {
  id: string;
  manifest: ApplicationManifestType | null;
}

async function loadManifest(manifestPath: string): Promise<ApplicationManifestType> {
  const text = await readFile(manifestPath, 'utf8');
  const parsed: unknown = JSON.parse(text);
  return ApplicationManifest.parse(parsed);
}

export async function agentsManifest(
  agentId: string,
  opts: AgentsManifestOptions = {},
): Promise<string> {
  if (opts.detach === true && opts.manifestPath) {
    throw new Error('Provide either a manifest file path or --detach, not both');
  }
  if (opts.detach === true) return detachManifest(agentId);
  if (!opts.manifestPath) {
    throw new Error('Provide a manifest file path or pass --detach');
  }
  const manifest = await loadManifest(opts.manifestPath);
  const c = await client();
  const updated = await c.patch<PatchedAgent>(`/agents/${agentId}`, { manifest });
  return kv([
    ['agentId', updated.id],
    ['manifest', updated.manifest?.name ?? '—'],
    ['action', 'attached'],
  ]);
}

async function detachManifest(agentId: string): Promise<string> {
  const c = await client();
  const updated = await c.patch<PatchedAgent>(`/agents/${agentId}`, { manifest: null });
  return kv([
    ['agentId', updated.id],
    ['manifest', updated.manifest?.name ?? '—'],
    ['action', 'detached'],
  ]);
}
