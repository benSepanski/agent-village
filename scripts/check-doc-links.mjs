#!/usr/bin/env node
// Fails when a relative Markdown link points at a path that does not exist.
// Prose rots silently; a broken link should fail loudly. See docs/dev/doc-system.md.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
// docs/legacy is frozen and describes a system that no longer exists; its links are expected to rot.
const SKIP = new Set([
  join(ROOT, 'node_modules'),
  join(ROOT, '.git'),
  join(ROOT, 'docs', 'legacy'),
]);

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (SKIP.has(path)) return [];
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith('.md') ? [path] : [];
  });
}

function withoutCode(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

function linkTargets(markdown) {
  return [...withoutCode(markdown).matchAll(/\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)].map((m) => m[1]);
}

function isExternal(target) {
  return /^(https?:|mailto:|#)/.test(target);
}

function brokenLinks(file) {
  const fromDir = dirname(file);
  return linkTargets(readFileSync(file, 'utf8'))
    .filter((target) => !isExternal(target))
    .filter((target) => !existsSync(resolve(fromDir, target.split('#')[0])))
    .map((target) => `${relative(ROOT, file)} -> ${target}`);
}

const broken = markdownFiles(ROOT).flatMap(brokenLinks);

if (broken.length > 0) {
  console.error(`${broken.length} broken relative link(s):`);
  for (const line of broken) console.error(`  ${line}`);
  process.exit(1);
}

console.log('All relative Markdown links resolve.');
