import { afterEach, describe, expect, it, vi } from 'vitest';
import { setApiClient, type ApiClient } from '../client.js';
import { agentsList } from './agents-list.js';
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
          createdAt: '2026-05-16T12:00:00.000Z',
        });
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
  it('renders the run detail with output', async () => {
    const get = vi.fn().mockResolvedValue({
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
    });
    setApiClient(fakeClient({ get }));
    const out = await logs(AGENT_ID, RUN_ID);
    expect(out).toContain(RUN_ID);
    expect(out).toContain('Hello');
  });

  it('renders the error when status is error', async () => {
    const get = vi.fn().mockResolvedValue({
      id: RUN_ID,
      agentId: AGENT_ID,
      status: 'error',
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 50,
      output: null,
      error: 'boom',
      traceId: 'Root=1',
      createdAt: '2026-05-16T12:00:00.000Z',
    });
    setApiClient(fakeClient({ get }));
    const out = await logs(AGENT_ID, RUN_ID);
    expect(out).toContain('boom');
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
