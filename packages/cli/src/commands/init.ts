import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { kv } from '../format.js';
import {
  agentJsonTemplate,
  appMjsTemplate,
  gitignoreTemplate,
  manifestTemplate,
  packageJsonTemplate,
  readmeTemplate,
  sanitizeAppName,
} from './init-templates.js';

async function ensureEmptyDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir);
  if (entries.length > 0) throw new Error(`${dir} already exists and is not empty`);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** Scaffold a new one-off agent-village app in `dir` (refuses a non-empty dir). */
export async function init(dir: string): Promise<string> {
  await ensureEmptyDir(dir);
  const name = sanitizeAppName(path.basename(path.resolve(dir)));
  await writeJson(path.join(dir, 'manifest.json'), manifestTemplate(name));
  await writeFile(path.join(dir, 'app.mjs'), appMjsTemplate(name), 'utf8');
  await writeJson(path.join(dir, 'package.json'), packageJsonTemplate(name));
  await writeJson(path.join(dir, 'agent.json'), agentJsonTemplate(name));
  await writeFile(path.join(dir, '.gitignore'), gitignoreTemplate(), 'utf8');
  await writeFile(path.join(dir, 'README.md'), readmeTemplate(name), 'utf8');
  return kv([
    ['name', name],
    ['dir', dir],
    ['next', `replace anthropicApiKey in ${path.join(dir, 'agent.json')}, then see README.md`],
  ]);
}
