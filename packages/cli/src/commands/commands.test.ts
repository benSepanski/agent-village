import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setApiClient, type ApiClient } from '../client.js';
import { agentsList } from './agents-list.js';
import { agentsManifest } from './agents-manifest.js';
import { agentsShow } from './agents-show.js';
import { logs } from './logs.js';
import { run } from './run.js';

const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const RUN_ID = '01HZN0PQRSTVWXYZ0123456789';

function fakeClient(over: Partial<ApiClient> = {}): ApiClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
    ...over,
  } as ApiClient;
}

afterEach(() => {
  setApiClient(undefined);
  vi.restoreAllMocks();
});

describe('agents list', () => {
  it('renders a table from /agents', async () => {
    const get = vi.fn().mockResolvedValue({
      agents: [
        {
          id: AGENT_ID,
          name: 'Daily',
          status: 'active',
          schedule: '*/5 * * * *',
          spendUsedUsd: 0.12,
          spendLimitUsd: 1,
        },
      ],
    });
    setApiClient(fakeClient({ get }));
    const out = await agentsList();
    expect(out).toContain(AGENT_ID);
    expect(out).toContain('Daily');
    expect(get).toHaveBeenCalledWith('/agents');
  });
});

describe('agents show', () => {
  it('combines agent meta and recent runs', async () => {
    const get = vi.fn().mockImplementation((path: string) => {
      if (path === `/agents/${AGENT_ID}`) {
        return Promise.resolve({
          id: AGENT_ID,
          name: 'Daily',
          model: 'claude-opus-4-7',
          systemPrompt: 'hi',
          schedule: '*/5 * * * *',
          spendLimitUsd: 1,
          spendUsedUsd: 0,
          status: 'active',
          manifest: null,
          createdAt: '2026-05-16T12:00:00.000Z',
        });
      }
      if (path === `/agents/${AGENT_ID}/spend`) {
        return Promise.resolve({ month: '2026-05', costUsd: 0.0123, runCount: 4 });
      }
      return Promise.resolve({
        runs: [
          {
            id: RUN_ID,
            status: 'ok',
            costUsd: 0.001,
            durationMs: 1234,
            createdAt: '2026-05-16T12:00:00.000Z',
          },
        ],
      });
    });
    setApiClient(fakeClient({ get }));
    const out = await agentsShow(AGENT_ID);
    expect(out).toContain(AGENT_ID);
    expect(out).toContain('recent runs');
    expect(out).toContain(RUN_ID);
    expect(get).toHaveBeenCalledWith(`/agents/${AGENT_ID}/spend`);
    expect(out).toContain('spend (month)');
    expect(out).toContain('$0.0123 across 4 runs (2026-05)');
  });

  it('lists grant kinds — including generic secret grants — in the manifest summary', async () => {
    const get = vi.fn().mockImplementation((path: string) => {
      if (path === `/agents/${AGENT_ID}`) {
        return Promise.resolve({
          id: AGENT_ID,
          name: 'Mailer',
          model: 'claude-opus-4-7',
          systemPrompt: 'hi',
          schedule: null,
          spendLimitUsd: 1,
          spendUsedUsd: 0,
          status: 'active',
          manifest: {
            name: 'gmail-agent',
            image: 'acct.dkr.ecr.us-east-1.amazonaws.com/app:latest',
            schedule: null,
            timeoutMinutes: 30,
            egressAllow: [],
            grants: [
              { kind: 'secret', name: 'gmail-app-password', env: 'GMAIL_APP_PASSWORD' },
              { kind: 'notion', secretName: `agent-village/dev/agents/${AGENT_ID}/notion-token` },
            ],
            flushIntervalSeconds: 300,
          },
          createdAt: '2026-05-16T12:00:00.000Z',
        });
      }
      if (path === `/agents/${AGENT_ID}/spend`) {
        return Promise.resolve({ month: '2026-05', costUsd: 0, runCount: 0 });
      }
      return Promise.resolve({ runs: [] });
    });
    setApiClient(fakeClient({ get }));
    const out = await agentsShow(AGENT_ID);
    expect(out).toContain('gmail-agent');
    expect(out).toContain('secret, notion');
  });
});

describe('run', () => {
  it('POSTs run-now and prints the run id', async () => {
    const post = vi.fn().mockResolvedValue({ runId: RUN_ID, status: 'ok' });
    setApiClient(fakeClient({ post }));
    const out = await run(AGENT_ID);
    expect(out).toContain(RUN_ID);
    expect(post).toHaveBeenCalledWith(`/agents/${AGENT_ID}/run-now`, {});
  });

  it('passes dryRun when requested', async () => {
    const post = vi.fn().mockResolvedValue({ runId: RUN_ID, status: 'ok' });
    setApiClient(fakeClient({ post }));
    await run(AGENT_ID, { dryRun: true });
    expect(post).toHaveBeenCalledWith(`/agents/${AGENT_ID}/run-now`, { dryRun: true });
  });
});

describe('logs', () => {
  const runDetail = {
    id: RUN_ID,
    agentId: AGENT_ID,
    status: 'ok',
    costUsd: 0.0021,
    tokensIn: 10,
    tokensOut: 20,
    durationMs: 567,
    output: 'Hello',
    error: null,
    traceId: 'Root=1',
    createdAt: '2026-05-16T12:00:00.000Z',
  };
  const detailPath = `/agents/${AGENT_ID}/runs/${RUN_ID}`;
  const isLogsPath = (path: string) => path.startsWith(`${detailPath}/logs`);

  it('renders the run detail with output and one page of logs', async () => {
    const get = vi.fn().mockImplementation((path: string) => {
      if (isLogsPath(path)) {
        return Promise.resolve({
          runStatus: 'ok',
          events: [{ at: '2026-05-16T12:00:00.100Z', source: 'app', message: 'syncing workspace' }],
          nextToken: null,
        });
      }
      return Promise.resolve(runDetail);
    });
    setApiClient(fakeClient({ get }));
    const out = await logs(AGENT_ID, RUN_ID);
    expect(out).toContain(RUN_ID);
    expect(out).toContain('Hello');
    expect(out).toContain('[app] syncing workspace');
  });

  it('renders the error when status is error', async () => {
    const get = vi.fn().mockImplementation((path: string) => {
      if (isLogsPath(path)) {
        return Promise.resolve({ runStatus: 'error', events: [], nextToken: null });
      }
      return Promise.resolve({ ...runDetail, status: 'error', output: null, error: 'boom' });
    });
    setApiClient(fakeClient({ get }));
    const out = await logs(AGENT_ID, RUN_ID);
    expect(out).toContain('boom');
  });

  it('drains CloudWatch pagination tokens within one fetch', async () => {
    const get = vi.fn().mockImplementation((path: string) => {
      if (isLogsPath(path) && path.includes('nextToken=tok1')) {
        return Promise.resolve({
          runStatus: 'ok',
          events: [{ at: '2026-05-16T12:00:01.000Z', source: 'egress-proxy', message: 'second' }],
          nextToken: null,
        });
      }
      if (isLogsPath(path)) {
        return Promise.resolve({
          runStatus: 'ok',
          events: [{ at: '2026-05-16T12:00:00.500Z', source: 'app', message: 'first' }],
          nextToken: 'tok1',
        });
      }
      return Promise.resolve(runDetail);
    });
    setApiClient(fakeClient({ get }));
    const out = await logs(AGENT_ID, RUN_ID);
    expect(out).toContain('first');
    expect(out).toContain('second');
  });

  it('--follow polls until the run reaches a terminal status', async () => {
    let poll = 0;
    const get = vi.fn().mockImplementation((path: string) => {
      if (!isLogsPath(path)) {
        return Promise.resolve({ ...runDetail, status: 'running' });
      }
      poll += 1;
      if (poll === 1) {
        return Promise.resolve({
          runStatus: 'running',
          events: [{ at: '2026-05-16T12:00:00.100Z', source: 'app', message: 'working…' }],
          nextToken: null,
        });
      }
      return Promise.resolve({
        runStatus: 'ok',
        events: [{ at: '2026-05-16T12:00:02.000Z', source: 'app', message: 'done' }],
        nextToken: null,
      });
    });
    setApiClient(fakeClient({ get }));
    const chunks: string[] = [];
    const out = await logs(AGENT_ID, RUN_ID, {
      follow: true,
      pollMs: 0,
      write: (chunk) => chunks.push(chunk),
    });
    const streamed = chunks.join('');
    expect(streamed).toContain('working…');
    expect(streamed).toContain('done');
    expect(out).toContain('run finished');
    // The second poll must start after the last event already printed.
    const secondPollPath = get.mock.calls
      .map((c) => c[0] as string)
      .filter(isLogsPath)
      .at(-1)!;
    expect(secondPollPath).toContain('startTime=');
  });
});

describe('agents manifest', () => {
  const manifest = {
    name: 'summarizer',
    image: '123.dkr.ecr.us-east-1.amazonaws.com/summarizer:latest',
    schedule: null,
    egressAllow: ['api.notion.com'],
    grants: [],
  };

  it('attaches a manifest read from a JSON file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'av-cli-'));
    const manifestPath = join(dir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest));
    const patch = vi.fn().mockResolvedValue({ id: AGENT_ID, manifest });
    setApiClient(fakeClient({ patch }));
    const out = await agentsManifest(AGENT_ID, { manifestPath });
    expect(patch).toHaveBeenCalledWith(
      `/agents/${AGENT_ID}`,
      expect.objectContaining({ manifest: expect.objectContaining({ name: 'summarizer' }) }),
    );
    expect(out).toContain('attached');
    await rm(dir, { recursive: true, force: true });
  });

  it('detaches a manifest with --detach', async () => {
    const patch = vi.fn().mockResolvedValue({ id: AGENT_ID, manifest: null });
    setApiClient(fakeClient({ patch }));
    const out = await agentsManifest(AGENT_ID, { detach: true });
    expect(patch).toHaveBeenCalledWith(`/agents/${AGENT_ID}`, { manifest: null });
    expect(out).toContain('detached');
  });

  it('throws when neither a path nor --detach is provided', async () => {
    await expect(agentsManifest(AGENT_ID)).rejects.toThrow();
  });

  it('rejects passing both a manifest path and --detach', async () => {
    await expect(
      agentsManifest(AGENT_ID, { manifestPath: '/tmp/manifest.json', detach: true }),
    ).rejects.toThrow(/not both/);
  });
});

describe('doctor', () => {
  it('reports each check', async () => {
    delete process.env['AV_API_URL'];
    delete process.env['AV_ACCESS_TOKEN'];
    const { doctor } = await import('./doctor.js');
    const out = await doctor();
    expect(out).toMatch(/AV_API_URL/);
    expect(out).toMatch(/AV_ACCESS_TOKEN/);
  });
});
