import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  EntryCtor: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('@napi-rs/keyring', () => ({ Entry: mocks.EntryCtor }));
vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }));

const SAMPLE = { refreshToken: 'rt', clientId: 'cid', domain: 'd.example' };
const FETCH_OK = { ok: true, json: async () => ({ access_token: 'tok-123' }) };

interface FakeEntry {
  getPassword: ReturnType<typeof vi.fn>;
  setPassword: ReturnType<typeof vi.fn>;
}

function makeEntry(opts: { password?: string | null; throws?: boolean } = {}): FakeEntry {
  return {
    getPassword: vi.fn(() => {
      if (opts.throws) throw new Error('backend offline');
      return opts.password ?? null;
    }),
    setPassword: vi.fn(),
  };
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  mocks.EntryCtor.mockReset();
  mocks.readFile.mockReset();
  fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(FETCH_OK as unknown as Response);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  delete process.env['AV_ACCESS_TOKEN'];
});

afterEach(() => {
  vi.restoreAllMocks();
});

function warningCount(): number {
  return stderrSpy.mock.calls.filter(
    ([chunk]) => typeof chunk === 'string' && chunk.includes('SECURITY WARNING'),
  ).length;
}

describe('getAccessToken', () => {
  it('returns AV_ACCESS_TOKEN directly when set', async () => {
    process.env['AV_ACCESS_TOKEN'] = 'override';
    const { getAccessToken } = await import('./auth.js');
    expect(await getAccessToken()).toBe('override');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.EntryCtor).not.toHaveBeenCalled();
  });

  it('uses the keychain blob when available', async () => {
    const entry = makeEntry({ password: JSON.stringify(SAMPLE) });
    mocks.EntryCtor.mockImplementation(() => entry);
    const { getAccessToken } = await import('./auth.js');
    expect(await getAccessToken()).toBe('tok-123');
    expect(entry.getPassword).toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it('migrates the legacy file blob into the keychain on first use', async () => {
    const entry = makeEntry({ password: null });
    mocks.EntryCtor.mockImplementation(() => entry);
    mocks.readFile.mockResolvedValue(JSON.stringify(SAMPLE));
    const { getAccessToken } = await import('./auth.js');
    expect(await getAccessToken()).toBe('tok-123');
    expect(entry.setPassword).toHaveBeenCalledWith(JSON.stringify(SAMPLE));
    expect(warningCount()).toBe(0);
  });

  it('warns once and falls back to the file when the keychain backend is unavailable', async () => {
    mocks.EntryCtor.mockImplementation(() => {
      throw new Error('native binding missing');
    });
    mocks.readFile.mockResolvedValue(JSON.stringify(SAMPLE));
    const { getAccessToken } = await import('./auth.js');
    expect(await getAccessToken()).toBe('tok-123');
    expect(await getAccessToken()).toBe('tok-123');
    expect(warningCount()).toBe(1);
  });

  it('throws an actionable error when no credentials are available anywhere', async () => {
    const entry = makeEntry({ password: null });
    mocks.EntryCtor.mockImplementation(() => entry);
    const enoent = Object.assign(new Error('not found'), { code: 'ENOENT' });
    mocks.readFile.mockRejectedValue(enoent);
    const { getAccessToken } = await import('./auth.js');
    await expect(getAccessToken()).rejects.toThrow(/AV_ACCESS_TOKEN/);
  });
});
