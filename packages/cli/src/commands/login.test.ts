import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveConfig } from '../config.js';
import { login, type LoginPrompter } from './login.js';

const mocks = vi.hoisted(() => ({
  saveCredentials: vi.fn(),
}));

vi.mock('../auth.js', () => ({ saveCredentials: mocks.saveCredentials }));

let dir: string;
let configPath: string;

function fakePrompter(over: Partial<LoginPrompter> = {}): LoginPrompter {
  return {
    email: vi.fn().mockResolvedValue('user@example.com'),
    password: vi.fn().mockResolvedValue('hunter2'),
    mfaCode: vi.fn().mockResolvedValue('000000'),
    ...over,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'av-cli-login-'));
  configPath = join(dir, 'config.json');
  mocks.saveCredentials.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

const BASE_OPTS = {
  apiUrl: 'https://api.example.com',
  region: 'us-east-1',
  clientId: 'cli-client',
};

describe('login', () => {
  it('requires apiUrl, region, and clientId on first login, naming what is missing', async () => {
    await expect(login({ configPath })).rejects.toThrow(/--api-url.*--region.*--client-id/s);
  });

  it('signs in with USER_PASSWORD_AUTH and persists the config + refresh token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        AuthenticationResult: { AccessToken: 'tok', RefreshToken: 'rt-abc' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const prompter = fakePrompter();
    const out = await login({ ...BASE_OPTS, configPath, prompter });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://cognito-idp.us-east-1.amazonaws.com/');
    expect(JSON.parse(init.body as string)).toEqual({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: 'cli-client',
      AuthParameters: { USERNAME: 'user@example.com', PASSWORD: 'hunter2' },
    });
    expect(mocks.saveCredentials).toHaveBeenCalledWith({
      kind: 'idp',
      region: 'us-east-1',
      clientId: 'cli-client',
      refreshToken: 'rt-abc',
    });
    expect(out).toContain('user@example.com');
    expect(out).toContain('signed in');
  });

  it('reuses saved config when flags are omitted on a later login', async () => {
    await saveConfig(BASE_OPTS, configPath);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        AuthenticationResult: { AccessToken: 'tok', RefreshToken: 'rt-abc' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await login({ configPath, prompter: fakePrompter() });
    expect(out).toContain('signed in');
  });

  it('answers a SOFTWARE_TOKEN_MFA challenge with the prompted code', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: 'sess-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          AuthenticationResult: { AccessToken: 'tok', RefreshToken: 'rt-mfa' },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const prompter = fakePrompter();
    await login({ ...BASE_OPTS, configPath, prompter });

    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(secondInit.body as string)).toEqual({
      ChallengeName: 'SOFTWARE_TOKEN_MFA',
      ClientId: 'cli-client',
      ChallengeResponses: { USERNAME: 'user@example.com', SOFTWARE_TOKEN_MFA_CODE: '000000' },
      Session: 'sess-1',
    });
    expect(prompter.mfaCode).toHaveBeenCalled();
    expect(mocks.saveCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'rt-mfa' }),
    );
  });

  it('rejects an unsupported challenge with a clear error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ChallengeName: 'NEW_PASSWORD_REQUIRED' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(login({ ...BASE_OPTS, configPath, prompter: fakePrompter() })).rejects.toThrow(
      /web UI/,
    );
  });
});
