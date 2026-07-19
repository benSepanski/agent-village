import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, resolveApiUrl, saveConfig } from './config.js';

let dir: string;
let configPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'av-cli-config-'));
  configPath = join(dir, 'nested', 'config.json');
  delete process.env['AV_API_URL'];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('returns null when the file is missing', async () => {
    expect(await loadConfig(configPath)).toBeNull();
  });

  it('round-trips a saved config, creating parent directories', async () => {
    const config = { apiUrl: 'https://api.example.com', region: 'us-east-1', clientId: 'abc123' };
    await saveConfig(config, configPath);
    expect(await loadConfig(configPath)).toEqual(config);
  });

  it('returns null for malformed JSON', async () => {
    await mkdir(join(dir, 'nested'), { recursive: true });
    await writeFile(configPath, 'not json', 'utf8');
    expect(await loadConfig(configPath)).toBeNull();
  });

  it('returns null when required fields are missing', async () => {
    await mkdir(join(dir, 'nested'), { recursive: true });
    await writeFile(configPath, JSON.stringify({ apiUrl: 'x' }), 'utf8');
    expect(await loadConfig(configPath)).toBeNull();
  });
});

describe('resolveApiUrl', () => {
  it('prefers AV_API_URL over the saved config', async () => {
    process.env['AV_API_URL'] = 'https://env.example.com';
    await saveConfig(
      { apiUrl: 'https://config.example.com', region: 'us-east-1', clientId: 'abc' },
      configPath,
    );
    expect(await resolveApiUrl(configPath)).toBe('https://env.example.com');
  });

  it('falls back to the saved config apiUrl', async () => {
    await saveConfig(
      { apiUrl: 'https://config.example.com', region: 'us-east-1', clientId: 'abc' },
      configPath,
    );
    expect(await resolveApiUrl(configPath)).toBe('https://config.example.com');
  });

  it('throws a clear error when neither is set', async () => {
    await expect(resolveApiUrl(configPath)).rejects.toThrow(/village login/);
  });
});
