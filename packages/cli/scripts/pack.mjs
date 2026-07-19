#!/usr/bin/env node
// Assembles packages/cli/dist/pkg into an installable npm package and packs
// it to a tarball. Run after `pnpm --filter @agent-village/cli bundle` (see
// the root `cli:pack` script) — expects dist/pkg/village.mjs to exist.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, '..');
const pkgDir = path.join(packageDir, 'dist', 'pkg');

async function readCliManifest() {
  const raw = await readFile(path.join(packageDir, 'package.json'), 'utf8');
  return JSON.parse(raw);
}

function buildPackedManifest(cliManifest) {
  const keyringRange = cliManifest.dependencies?.['@napi-rs/keyring'];
  if (!keyringRange) throw new Error('cli package.json is missing the @napi-rs/keyring dependency');
  return {
    name: '@agent-village/cli',
    version: cliManifest.version,
    type: 'module',
    bin: { village: './village.mjs' },
    engines: { node: '>=22' },
    optionalDependencies: { '@napi-rs/keyring': keyringRange },
  };
}

function runNpmPack() {
  const output = execFileSync('npm', ['pack'], { cwd: pkgDir, encoding: 'utf8' });
  const tarballName = output.trim().split('\n').at(-1);
  if (!tarballName) throw new Error('npm pack produced no output');
  return path.join(pkgDir, tarballName);
}

async function main() {
  const cliManifest = await readCliManifest();
  const packedManifest = buildPackedManifest(cliManifest);
  await writeFile(
    path.join(pkgDir, 'package.json'),
    `${JSON.stringify(packedManifest, null, 2)}\n`,
    'utf8',
  );
  const tarballPath = runNpmPack();
  process.stdout.write(`${tarballPath}\n`);
}

await main();
