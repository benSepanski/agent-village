import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { WorkspacePath } from '@agent-village/shared';
import type {
  PresignedWorkspaceUrl,
  PresignWorkspaceResponse,
  WorkspaceOp,
} from '@agent-village/shared';
import type { ApiClient } from '../client.js';
import { kv } from '../format.js';

/** Mirrors PresignWorkspaceInput's `files` cap (packages/shared/src/schemas/workspace.ts). */
const PRESIGN_BATCH_SIZE = 100;
const SKIP_DIR_NAMES = new Set(['.git', 'node_modules']);

export interface LocalFile {
  localPath: string;
  workspacePath: string;
}

function toPosixPath(p: string): string {
  return p.split(sep).join('/');
}

function trimSlashes(s: string): string {
  return s.replace(/^\/+|\/+$/g, '');
}

/** Prefix a relative path with --dest (if given) and validate it client-side, fail-fast. */
function buildWorkspacePath(dest: string | undefined, relPath: string): string {
  const raw = dest ? `${trimSlashes(dest)}/${relPath}` : relPath;
  const parsed = WorkspacePath.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'invalid path';
    throw new Error(`invalid workspace path "${raw}": ${message}`);
  }
  return parsed.data;
}

async function walkDir(
  root: string,
  dir: string,
  dest: string | undefined,
  out: LocalFile[],
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIR_NAMES.has(entry.name)) await walkDir(root, entryPath, dest, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const relPath = toPosixPath(relative(root, entryPath));
    out.push({ localPath: entryPath, workspacePath: buildWorkspacePath(dest, relPath) });
  }
}

/**
 * Collect files under `localPath` for push. A file pushes as itself (named by
 * its basename under --dest); a directory walks recursively, skipping .git,
 * node_modules, and symlinks, with paths relative to the directory root.
 */
export async function walkLocalPath(
  localPath: string,
  dest: string | undefined,
): Promise<LocalFile[]> {
  const rootStat = await stat(localPath);
  if (rootStat.isFile()) {
    return [{ localPath, workspacePath: buildWorkspacePath(dest, basename(localPath)) }];
  }
  const out: LocalFile[] = [];
  await walkDir(localPath, localPath, dest, out);
  return out;
}

function batch<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** Presign in batches of ≤100, returning results keyed by `${op}:${path}`. */
export async function presignBatches(
  c: ApiClient,
  agentId: string,
  files: Array<{ path: string; op: WorkspaceOp }>,
): Promise<Map<string, PresignedWorkspaceUrl>> {
  const result = new Map<string, PresignedWorkspaceUrl>();
  for (const chunk of batch(files, PRESIGN_BATCH_SIZE)) {
    const res = await c.post<PresignWorkspaceResponse>(`/agents/${agentId}/workspace/presign`, {
      files: chunk,
    });
    for (const u of res.urls) result.set(`${u.op}:${u.path}`, u);
  }
  return result;
}

export function lookupPresigned(
  presigned: Map<string, PresignedWorkspaceUrl>,
  op: WorkspaceOp,
  path: string,
): PresignedWorkspaceUrl {
  const url = presigned.get(`${op}:${path}`);
  if (!url) throw new Error(`missing presigned URL for ${path}`);
  return url;
}

async function assertOk(res: Response, method: string, workspacePath: string): Promise<void> {
  if (res.ok) return;
  const text = await res.text();
  throw new Error(`${method} ${workspacePath} → ${res.status}: ${text}`);
}

/** PUT a local file's bytes to a presigned URL; returns bytes sent. */
export async function putFile(
  url: string,
  localPath: string,
  workspacePath: string,
): Promise<number> {
  const body = await readFile(localPath);
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body,
  });
  await assertOk(res, 'PUT', workspacePath);
  return body.byteLength;
}

/** GET a presigned URL and write it under `destPath`, creating parent dirs; returns bytes written. */
export async function getFile(
  url: string,
  destPath: string,
  workspacePath: string,
): Promise<number> {
  const res = await fetch(url, { method: 'GET' });
  await assertOk(res, 'GET', workspacePath);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, buf);
  return buf.byteLength;
}

export async function deleteFile(url: string, workspacePath: string): Promise<void> {
  const res = await fetch(url, { method: 'DELETE' });
  await assertOk(res, 'DELETE', workspacePath);
}

/** Resolve `workspacePath` under `destDir`, refusing to write outside it. */
export function safeDestPath(destDir: string, workspacePath: string): string {
  const base = resolve(destDir);
  const target = resolve(base, workspacePath);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`refusing to write outside ${destDir}: ${workspacePath}`);
  }
  return target;
}

/** Per-file lines plus a trailing files/bytes total, in transfer order. */
export function transferSummary(items: Array<{ path: string; size: number }>): string {
  const lines = items.map((i) => `${i.path}  (${i.size} bytes)`);
  const totalBytes = items.reduce((sum, i) => sum + i.size, 0);
  lines.push('');
  lines.push(
    kv([
      ['files', String(items.length)],
      ['bytes', String(totalBytes)],
    ]),
  );
  return lines.join('\n');
}
