import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApplicationManifest, CreateAgentInput } from '@agent-village/shared';
import { init } from './init.js';
import { sanitizeAppName } from './init-templates.js';

async function tmpParent(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'av-cli-init-'));
}

describe('sanitizeAppName', () => {
  it('lowercases, replaces illegal chars with -, and trims', () => {
    expect(sanitizeAppName('My App!')).toBe('my-app');
    expect(sanitizeAppName('--Weird__Name--')).toBe('weird-name');
  });

  it('falls back to a default when nothing sanitizable survives', () => {
    expect(sanitizeAppName('!!!')).toBe('app');
  });
});

describe('init', () => {
  it('scaffolds every expected file', async () => {
    const parent = await tmpParent();
    const dir = join(parent, 'my-app');
    await init(dir);
    const names = await Promise.all(
      ['manifest.json', 'app.mjs', 'package.json', 'agent.json', '.gitignore', 'README.md'].map(
        async (f) => {
          await readFile(join(dir, f), 'utf8');
          return f;
        },
      ),
    );
    expect(names).toHaveLength(6);
  });

  it('generates a manifest.json that parses as ApplicationManifest', async () => {
    const parent = await tmpParent();
    const dir = join(parent, 'my-app');
    await init(dir);
    const raw: unknown = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    expect(() => ApplicationManifest.parse(raw)).not.toThrow();
  });

  it('generates an agent.json that parses as CreateAgentInput', async () => {
    const parent = await tmpParent();
    const dir = join(parent, 'my-app');
    await init(dir);
    const raw: unknown = JSON.parse(await readFile(join(dir, 'agent.json'), 'utf8'));
    expect(() => CreateAgentInput.parse(raw)).not.toThrow();
  });

  it('sanitizes a messy directory name into a valid app name', async () => {
    const parent = await tmpParent();
    const dir = join(parent, 'My App!');
    await init(dir);
    const manifest: { name: string } = JSON.parse(
      await readFile(join(dir, 'manifest.json'), 'utf8'),
    );
    expect(manifest.name).toBe('my-app');
  });

  it('refuses to scaffold into a non-empty directory', async () => {
    const parent = await tmpParent();
    const dir = join(parent, 'occupied');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'existing.txt'), 'hi', 'utf8');
    await expect(init(dir)).rejects.toThrow(/not empty/);
  });

  it('is fine scaffolding into an already-created empty directory', async () => {
    const parent = await tmpParent();
    const dir = join(parent, 'empty');
    await mkdir(dir, { recursive: true });
    await expect(init(dir)).resolves.toBeTruthy();
  });
});
