import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.turbo', 'cdk.out', 'coverage']);

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return SKIP_DIRS.has(entry.name) ? [] : markdownFiles(full);
    }
    return entry.name.endsWith('.md') ? [full] : [];
  });
}

const RELATIVE_LINK = /\[[^\]]*\]\((?!https?:|mailto:|#)([^)#\s]+)(#[^)\s]*)?\)/g;

function brokenLinksIn(file: string): string[] {
  const broken: string[] = [];
  const text = readFileSync(file, 'utf-8');
  for (const match of text.matchAll(RELATIVE_LINK)) {
    const linkPath = match[1];
    if (linkPath === undefined) continue;
    const target = resolve(dirname(file), decodeURI(linkPath));
    if (!existsSync(target)) {
      broken.push(`${file.slice(repoRoot.length + 1)} → ${linkPath}`);
    }
  }
  return broken;
}

describe('markdown relative links', () => {
  it('every relative link in a .md file resolves to an existing path', () => {
    const broken = markdownFiles(repoRoot).flatMap(brokenLinksIn);
    expect(broken, `Broken doc links:\n${broken.join('\n')}`).toEqual([]);
  });
});
