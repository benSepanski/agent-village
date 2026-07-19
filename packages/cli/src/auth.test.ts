import type * as NodeFsPromises from 'node:fs/promises';
import type * as NodeOs from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  EntryCtor: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('@napi-rs/keyring', () => ({ Entry: mocks.EntryCtor }));
vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
  mkdir: mocks.mkdir,
  unlink: mocks.unlink,
}));

const SAMPLE = { refreshToken: 'rt', clientId: 'cid', domain: 'd.example' };
const SAMPLE_IDP = {
  kind: 'idp' as const,
  region: 'us-east-1',
  clientId: 'cid',
  refreshToken: 'rt',
};
const FETCH_OK = { ok: true, json: async () => ({ access_token: 'tok-123' }) };

interface FakeEntry {
  getPassword: ReturnType<typeof vi.fn>;
  setPassword: ReturnType<typeof vi.fn>;
  deletePassword: ReturnType<typeof vi.fn>;
}

function makeEntry(opts: { password?: string | null; throws?: boolean } = {}): FakeEntry {
  return {
    getPassword: vi.fn(() => {
      if (opts.throws) throw new Error('backend offline');
      return opts.password ?? null;
    }),
    setPassword: vi.fn(),
    deletePassword: vi.fn(() => true),
  };
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  mocks.EntryCtor.mockReset();
  mocks.readFile.mockReset();
  mocks.writeFile.mockReset().mockResolvedValue(undefined);
  mocks.mkdir.mockReset().mockResolvedValue(undefined);
  mocks.unlink.mockReset().mockResolvedValue(undefined);
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
    mocks.EntryCtor.mockImplementation(function () {
      return entry;
    });
    const { getAccessToken } = await import('./auth.js');
    expect(await getAccessToken()).toBe('tok-123');
    expect(entry.getPassword).toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it('migrates the legacy file blob into the keychain on first use', async () => {
    const entry = makeEntry({ password: null });
    mocks.EntryCtor.mockImplementation(function () {
      return entry;
    });
    mocks.readFile.mockResolvedValue(JSON.stringify(SAMPLE));
    const { getAccessToken } = await import('./auth.js');
    expect(await getAccessToken()).toBe('tok-123');
    expect(entry.setPassword).toHaveBeenCalledWith(JSON.stringify(SAMPLE));
    expect(warningCount()).toBe(0);
  });

  it('warns once and falls back to the file when the keychain backend is unavailable', async () => {
    mocks.EntryCtor.mockImplementation(function () {
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
    mocks.EntryCtor.mockImplementation(function () {
      return entry;
    });
    const enoent = Object.assign(new Error('not found'), { code: 'ENOENT' });
    mocks.readFile.mockRejectedValue(enoent);
    const { getAccessToken } = await import('./auth.js');
    await expect(getAccessToken()).rejects.toThrow(/AV_ACCESS_TOKEN/);
  });

  it('refreshes an idp-shaped stored credential via cognito-idp REFRESH_TOKEN_AUTH', async () => {
    const entry = makeEntry({ password: JSON.stringify(SAMPLE_IDP) });
    mocks.EntryCtor.mockImplementation(function () {
      return entry;
    });
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ AuthenticationResult: { AccessToken: 'idp-tok-456' } }),
    } as unknown as Response);
    const { getAccessToken } = await import('./auth.js');
    expect(await getAccessToken()).toBe('idp-tok-456');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://cognito-idp.us-east-1.amazonaws.com/');
    expect((init.headers as Record<string, string>)['x-amz-target']).toBe(
      'AWSCognitoIdentityProviderService.InitiateAuth',
    );
    expect(JSON.parse(init.body as string)).toEqual({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: 'cid',
      AuthParameters: { REFRESH_TOKEN: 'rt' },
    });
  });

  it('still refreshes a legacy stored credential via oauth2/token', async () => {
    const entry = makeEntry({ password: JSON.stringify(SAMPLE) });
    mocks.EntryCtor.mockImplementation(function () {
      return entry;
    });
    const { getAccessToken } = await import('./auth.js');
    expect(await getAccessToken()).toBe('tok-123');
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe('https://d.example/oauth2/token');
  });
});

describe('saveCredentials', () => {
  it('writes to the keychain when available', async () => {
    const entry = makeEntry();
    mocks.EntryCtor.mockImplementation(function () {
      return entry;
    });
    const { saveCredentials } = await import('./auth.js');
    await saveCredentials(SAMPLE_IDP);
    expect(entry.setPassword).toHaveBeenCalledWith(JSON.stringify(SAMPLE_IDP));
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('falls back to the plaintext file when the keychain is unavailable', async () => {
    mocks.EntryCtor.mockImplementation(function () {
      throw new Error('native binding missing');
    });
    const { saveCredentials } = await import('./auth.js');
    await saveCredentials(SAMPLE_IDP);
    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('credentials'),
      JSON.stringify(SAMPLE_IDP),
      { encoding: 'utf8', mode: 0o600 },
    );
    expect(mocks.mkdir).toHaveBeenCalledWith(expect.any(String), {
      recursive: true,
      mode: 0o700,
    });
  });

  it('writes the fallback credentials file with 0600 permissions on disk', async () => {
    const os = await vi.importActual<typeof NodeOs>('node:os');
    const fsActual = await vi.importActual<typeof NodeFsPromises>('node:fs/promises');
    const dir = await fsActual.mkdtemp(join(os.tmpdir(), 'av-cli-auth-'));
    try {
      vi.doMock('node:os', () => ({ ...os, homedir: () => dir }));
      mocks.mkdir.mockImplementation(fsActual.mkdir);
      mocks.writeFile.mockImplementation(fsActual.writeFile);
      mocks.EntryCtor.mockImplementation(function () {
        throw new Error('native binding missing');
      });

      const { saveCredentials } = await import('./auth.js');
      await saveCredentials(SAMPLE_IDP);

      const credPath = join(dir, '.config', 'agent-village', 'credentials');
      const stats = await fsActual.stat(credPath);
      expect(stats.mode & 0o777).toBe(0o600);
    } finally {
      vi.doUnmock('node:os');
      await fsActual.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('clearCredentials', () => {
  it('deletes the keychain entry and unlinks the plaintext file', async () => {
    const entry = makeEntry();
    mocks.EntryCtor.mockImplementation(function () {
      return entry;
    });
    const { clearCredentials } = await import('./auth.js');
    await clearCredentials();
    expect(entry.deletePassword).toHaveBeenCalled();
    expect(mocks.unlink).toHaveBeenCalled();
  });

  it('ignores ENOENT when the plaintext file does not exist', async () => {
    mocks.EntryCtor.mockImplementation(function () {
      throw new Error('native binding missing');
    });
    const enoent = Object.assign(new Error('not found'), { code: 'ENOENT' });
    mocks.unlink.mockRejectedValue(enoent);
    const { clearCredentials } = await import('./auth.js');
    await expect(clearCredentials()).resolves.toBeUndefined();
  });
});
