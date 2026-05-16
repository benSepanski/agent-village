import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

describe('eslint hard bounds', () => {
  it('passes root eslint with zero warnings', () => {
    const result = spawnSync('pnpm', ['exec', 'eslint', '.', '--max-warnings=0'], {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    if (result.status !== 0) {
      console.error(result.stdout, result.stderr);
    }
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});
