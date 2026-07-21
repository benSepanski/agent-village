import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentsList } from './agents-list.js';

// AWS-free "consume an existing deployment" smoke test (M5, AC-5.3 / Task 2).
// `village login` normally captures --api-url/--region/--client-id and hits
// real Cognito; here a plain http.createServer stands in for the deployed
// HTTP API, and AV_API_URL + AV_ACCESS_TOKEN are set directly — both are real
// supported code paths (resolveApiUrl and getAccessToken honor them,
// bypassing Cognito entirely), so this proves the actual consume-path
// plumbing (config.ts resolveApiUrl, auth.ts getAccessToken, client.ts
// request()) round-trips against a deployed-shaped API, with no AWS and no
// mocked ApiClient.
const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const VALID_TOKEN = 'valid-gateway-bearer-token';

interface Fixture {
  server: Server;
  baseUrl: string;
  homeDir: string;
  receivedAuthHeaders: string[];
}

let fx: Fixture;

function requestHandler(req: IncomingMessage, res: ServerResponse): void {
  fx.receivedAuthHeaders.push(req.headers.authorization ?? '');
  if (req.method === 'GET' && req.url === '/agents') {
    if (req.headers.authorization !== `Bearer ${VALID_TOKEN}`) {
      res.writeHead(401, { 'content-type': 'text/plain' }).end('Unauthorized');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        agents: [
          {
            id: AGENT_ID,
            name: 'Daily digest',
            status: 'active',
            schedule: 'rate(1 day)',
            spendUsedUsd: 0.5,
            spendLimitUsd: 5,
          },
        ],
      }),
    );
    return;
  }
  res.writeHead(404).end('not found');
}

beforeAll(async () => {
  const server = createServer(requestHandler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server did not bind');
  fx = {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    homeDir: '',
    receivedAuthHeaders: [],
  };
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    fx.server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(async () => {
  fx.homeDir = await mkdtemp(join(tmpdir(), 'av-cli-consume-'));
  fx.receivedAuthHeaders = [];
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(fx.homeDir, { recursive: true, force: true });
});

/**
 * config.ts's DEFAULT_CONFIG_PATH and auth.ts's CRED_PATH are computed once,
 * at module load, from `homedir()` — neither takes a path override through
 * client.ts. `vi.stubEnv('HOME', ...)` alone would arrive too late for a
 * module already imported at the top of this file, so the two deny-path
 * tests that fall through to those real (unset) defaults stub HOME *first*,
 * then force a fresh module graph via resetModules + a dynamic re-import —
 * the same technique packages/infra/test/config.test.ts uses for
 * AV_PROD_ACCOUNT_ID. This keeps the isolated HOME dir load-bearing (this
 * test never reads/writes the developer's real ~/.config/agent-village)
 * instead of merely happening to pass because that path is empty today.
 */
async function freshAgentsList(): Promise<typeof agentsList> {
  vi.resetModules();
  const mod = await import('./agents-list.js');
  return mod.agentsList;
}

describe('consume an existing deployment: allow path', () => {
  it('resolves config from AV_API_URL/AV_ACCESS_TOKEN and round-trips agentsList against the stand-in', async () => {
    vi.stubEnv('AV_API_URL', fx.baseUrl);
    vi.stubEnv('AV_ACCESS_TOKEN', VALID_TOKEN);

    const out = await agentsList();

    expect(out).toContain(AGENT_ID);
    expect(out).toContain('Daily digest');
    expect(fx.receivedAuthHeaders).toEqual([`Bearer ${VALID_TOKEN}`]);
  });
});

describe('consume an existing deployment: deny paths', () => {
  it('fails with a clear error when neither AV_API_URL nor a saved config is present', async () => {
    vi.stubEnv('HOME', fx.homeDir);
    const list = await freshAgentsList();
    await expect(list()).rejects.toThrow(/No API URL configured\. Set AV_API_URL/);
  });

  it('fails with a clear error when AV_ACCESS_TOKEN is unset and no credentials are stored', async () => {
    vi.stubEnv('HOME', fx.homeDir);
    vi.stubEnv('AV_API_URL', fx.baseUrl);
    const list = await freshAgentsList();
    // AV_ACCESS_TOKEN deliberately left unset; the isolated HOME has no
    // saved ~/.config/agent-village/credentials fallback file. The OS
    // keychain lookup ahead of that fallback is real but harmless: the
    // service/account this CLI queries has never been provisioned in this
    // test process, so it resolves to "not found" without prompting.
    await expect(list()).rejects.toThrow(/No stored credentials found\. Run `village login`/);
    // The request never reached the stand-in — resolution failed first.
    expect(fx.receivedAuthHeaders).toEqual([]);
  });

  it('surfaces the stand-in 401 as the client error when the token is wrong', async () => {
    vi.stubEnv('AV_API_URL', fx.baseUrl);
    vi.stubEnv('AV_ACCESS_TOKEN', 'not-the-right-token');

    await expect(agentsList()).rejects.toThrow(/GET \/agents → 401/);
    expect(fx.receivedAuthHeaders).toEqual(['Bearer not-the-right-token']);
  });
});
