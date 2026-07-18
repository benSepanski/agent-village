import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setApiClient, type ApiClient } from '../client.js';
import { workspaceLs } from './workspace-ls.js';
import { workspacePull } from './workspace-pull.js';
import { workspacePush } from './workspace-push.js';
import { workspaceRm } from './workspace-rm.js';

const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';

function fakeClient(over: Partial<ApiClient> = {}): ApiClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
    ...over,
  } as ApiClient;
}

function fakeResponse(over: Partial<Response> & { body?: string } = {}): Response {
  const body = over.body ?? '';
  return {
    ok: over.ok ?? true,
    status: over.status ?? 200,
    text: async () => body,
    // Buffer.from(string).buffer would return Node's shared pooled ArrayBuffer
    // (larger than `body`, containing unrelated bytes) — TextEncoder gives an
    // exactly-sized one, matching what a real Response.arrayBuffer() returns.
    arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
    ...over,
  } as Response;
}

async function tmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'av-cli-ws-'));
}

afterEach(() => {
  setApiClient(undefined);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('workspace ls', () => {
  it('renders a table with path, size, lastModified', async () => {
    const get = vi.fn().mockResolvedValue({
      entries: [{ path: 'state.json', size: 42, lastModified: '2026-05-16T12:00:00.000Z' }],
      truncated: false,
    });
    setApiClient(fakeClient({ get }));
    const out = await workspaceLs(AGENT_ID);
    expect(get).toHaveBeenCalledWith(`/agents/${AGENT_ID}/workspace`);
    expect(out).toContain('state.json');
    expect(out).toContain('42');
    expect(out).not.toContain('truncated');
  });

  it('reports an empty workspace', async () => {
    setApiClient(fakeClient({ get: vi.fn().mockResolvedValue({ entries: [], truncated: false }) }));
    expect(await workspaceLs(AGENT_ID)).toContain('empty');
  });

  it('prints a trailing note when truncated', async () => {
    const get = vi.fn().mockResolvedValue({
      entries: [{ path: 'a.txt', size: 1, lastModified: '2026-05-16T12:00:00.000Z' }],
      truncated: true,
    });
    setApiClient(fakeClient({ get }));
    expect(await workspaceLs(AGENT_ID)).toContain('truncated');
  });
});

describe('workspace push', () => {
  it('walks a directory, skips .git/node_modules/symlinks, and uploads via presigned PUT', async () => {
    const dir = await tmpDir();
    await writeFile(join(dir, 'a.txt'), 'hello');
    await mkdir(join(dir, 'sub'));
    await writeFile(join(dir, 'sub', 'b.txt'), 'world!');
    await mkdir(join(dir, '.git'));
    await writeFile(join(dir, '.git', 'ignored'), 'nope');
    await mkdir(join(dir, 'node_modules'));
    await writeFile(join(dir, 'node_modules', 'ignored'), 'nope');
    await symlink(join(dir, 'a.txt'), join(dir, 'link.txt'));

    const post = vi
      .fn()
      .mockImplementation((_path: string, body: { files: { path: string; op: string }[] }) =>
        Promise.resolve({
          urls: body.files.map((f) => ({
            path: f.path,
            op: f.op,
            url: `https://s3.example/${f.path}`,
            expiresAt: '2026-05-16T12:15:00.000Z',
          })),
        }),
      );
    setApiClient(fakeClient({ post }));
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse());
    vi.stubGlobal('fetch', fetchMock);

    const out = await workspacePush(AGENT_ID, dir, { dest: 'run1' });

    expect(post).toHaveBeenCalledTimes(1);
    const [, body] = post.mock.calls[0]! as [string, { files: { path: string }[] }];
    const paths = body.files.map((f) => f.path).sort();
    expect(paths).toEqual(['run1/a.txt', 'run1/sub/b.txt']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://s3.example/run1/a.txt',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(out).toContain('run1/a.txt');
    expect(out).toContain('run1/sub/b.txt');
    expect(out).toMatch(/files\s+2/);

    await rm(dir, { recursive: true, force: true });
  });

  it('presigns in batches of 100 when pushing more than 100 files', async () => {
    const dir = await tmpDir();
    for (let i = 0; i < 150; i += 1) {
      await writeFile(join(dir, `f${i}.txt`), String(i));
    }
    const post = vi
      .fn()
      .mockImplementation((_path: string, body: { files: { path: string; op: string }[] }) =>
        Promise.resolve({
          urls: body.files.map((f) => ({
            path: f.path,
            op: f.op,
            url: `https://s3.example/${f.path}`,
            expiresAt: '2026-05-16T12:15:00.000Z',
          })),
        }),
      );
    setApiClient(fakeClient({ post }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse()));

    const out = await workspacePush(AGENT_ID, dir);

    expect(post).toHaveBeenCalledTimes(2);
    expect(out).toMatch(/files\s+150/);

    await rm(dir, { recursive: true, force: true });
  });

  it('rejects a client-side invalid workspace path before any network call', async () => {
    const dir = await tmpDir();
    await writeFile(join(dir, 'ok.txt'), 'x');
    const post = vi.fn();
    setApiClient(fakeClient({ post }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(workspacePush(AGENT_ID, dir, { dest: '../escape' })).rejects.toThrow(
      /invalid workspace path/,
    );
    expect(post).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    await rm(dir, { recursive: true, force: true });
  });

  it('throws including the path and status on a non-2xx PUT', async () => {
    const dir = await tmpDir();
    await writeFile(join(dir, 'a.txt'), 'hello');
    const post = vi.fn().mockResolvedValue({
      urls: [{ path: 'a.txt', op: 'put', url: 'https://s3.example/a.txt', expiresAt: 'x' }],
    });
    setApiClient(fakeClient({ post }));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 403, body: 'Forbidden' })),
    );

    await expect(workspacePush(AGENT_ID, dir)).rejects.toThrow(/a\.txt.*403/s);

    await rm(dir, { recursive: true, force: true });
  });
});

describe('workspace pull', () => {
  it('lists, filters by --prefix, and downloads files preserving relative paths', async () => {
    const dir = await tmpDir();
    const get = vi.fn().mockResolvedValue({
      entries: [
        { path: 'run1/a.txt', size: 5, lastModified: '2026-05-16T12:00:00.000Z' },
        { path: 'other/b.txt', size: 3, lastModified: '2026-05-16T12:00:00.000Z' },
      ],
      truncated: false,
    });
    const post = vi
      .fn()
      .mockImplementation((_path: string, body: { files: { path: string; op: string }[] }) =>
        Promise.resolve({
          urls: body.files.map((f) => ({
            path: f.path,
            op: f.op,
            url: `https://s3.example/${f.path}`,
            expiresAt: 'x',
          })),
        }),
      );
    setApiClient(fakeClient({ get, post }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ body: 'hello' })));

    const out = await workspacePull(AGENT_ID, dir, { prefix: 'run1' });

    const [, body] = post.mock.calls[0]! as [string, { files: { path: string }[] }];
    expect(body.files.map((f) => f.path)).toEqual(['run1/a.txt']);
    const written = await readFile(join(dir, 'run1', 'a.txt'), 'utf8');
    expect(written).toBe('hello');
    expect(out).toContain('run1/a.txt');
    expect(out).toMatch(/files\s+1/);

    await rm(dir, { recursive: true, force: true });
  });
});

describe('workspace rm', () => {
  it('presigns a single delete and issues it', async () => {
    const post = vi.fn().mockResolvedValue({
      urls: [{ path: 'a.txt', op: 'delete', url: 'https://s3.example/a.txt', expiresAt: 'x' }],
    });
    setApiClient(fakeClient({ post }));
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse());
    vi.stubGlobal('fetch', fetchMock);

    const out = await workspaceRm(AGENT_ID, 'a.txt');

    expect(post).toHaveBeenCalledWith(`/agents/${AGENT_ID}/workspace/presign`, {
      files: [{ path: 'a.txt', op: 'delete' }],
    });
    expect(fetchMock).toHaveBeenCalledWith('https://s3.example/a.txt', { method: 'DELETE' });
    expect(out).toContain('deleted');
    expect(out).toContain('a.txt');
  });
});
