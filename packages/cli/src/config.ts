import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_CONFIG_PATH = join(homedir(), '.config', 'agent-village', 'config.json');

export interface CliConfig {
  apiUrl: string;
  region: string;
  clientId: string;
}

function isCliConfig(value: unknown): value is CliConfig {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o['apiUrl'] === 'string' &&
    typeof o['region'] === 'string' &&
    typeof o['clientId'] === 'string'
  );
}

/** Non-secret CLI config persisted at ~/.config/agent-village/config.json. Never null values, no secrets. */
export async function loadConfig(path: string = DEFAULT_CONFIG_PATH): Promise<CliConfig | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isCliConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveConfig(
  config: CliConfig,
  path: string = DEFAULT_CONFIG_PATH,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

/**
 * API base URL resolution order used everywhere in the CLI: AV_API_URL env
 * var, then the persisted config's apiUrl, then a clear error telling the
 * user to log in.
 */
export async function resolveApiUrl(path: string = DEFAULT_CONFIG_PATH): Promise<string> {
  const env = process.env['AV_API_URL'];
  if (env) return env;
  const config = await loadConfig(path);
  if (config) return config.apiUrl;
  throw new Error(
    'No API URL configured. Set AV_API_URL or run `village login --api-url <url> --region <region> --client-id <id>`.',
  );
}
