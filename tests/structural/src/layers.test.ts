import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

describe('package layer graph', () => {
  it('passes dependency-cruiser with zero error-severity violations', () => {
    const result = spawnSync(
      'pnpm',
      [
        'exec',
        'depcruise',
        'packages',
        'tools',
        '--config',
        '.dependency-cruiser.cjs',
        '--output-type',
        'err',
      ],
      { cwd: repoRoot, encoding: 'utf-8' },
    );
    if (result.status !== 0) {
      console.error(result.stdout, result.stderr);
    }
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});
