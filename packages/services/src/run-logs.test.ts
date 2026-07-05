import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { agentRepoMock, runRepoMock } = vi.hoisted(() => ({
  agentRepoMock: { getAgent: vi.fn() },
  runRepoMock: { getOne: vi.fn() },
}));

vi.mock('@agent-village/data', () => ({
  agentRepo: agentRepoMock,
  runRepo: runRepoMock,
  secrets: {},
  userRepo: {},
}));

import type { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';
import { AgentNotFoundError, RunNotFoundError } from '@agent-village/domain';
import { getRunLogs, setLogsClient } from './run-logs.js';

const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const RUN_ID = '01HZN0PQRSTVWXYZ0123456789';
const SUB = 'cog-sub-abc';
const TASK_ID = 'abc123def456';
const TASK_ARN = `arn:aws:ecs:us-east-1:0:task/agent-village-dev-sandbox/${TASK_ID}`;

const sandboxRun = {
  id: RUN_ID,
  agentId: AGENT_ID,
  ownerSub: SUB,
  status: 'running',
  kind: 'sandbox',
  taskArn: TASK_ARN,
  createdAt: '2026-07-01T12:00:00.000Z',
};

const sendMock = vi.fn();

beforeEach(() => {
  agentRepoMock.getAgent.mockReset().mockResolvedValue({ id: AGENT_ID, ownerSub: SUB });
  runRepoMock.getOne.mockReset().mockResolvedValue(sandboxRun);
  sendMock.mockReset();
  setLogsClient({ send: sendMock } as unknown as CloudWatchLogsClient);
  process.env['AV_SANDBOX_LOG_GROUP'] = 'agent-village-dev-sandbox';
});

afterEach(() => {
  setLogsClient(undefined);
  delete process.env['AV_SANDBOX_LOG_GROUP'];
});

describe('getRunLogs', () => {
  it('filters both container streams derived from the taskArn', async () => {
    sendMock.mockResolvedValue({
      events: [
        {
          timestamp: Date.parse('2026-07-01T12:00:01.000Z'),
          message: 'hello\n',
          logStreamName: `sandbox/app/${TASK_ID}`,
        },
        {
          timestamp: Date.parse('2026-07-01T12:00:02.000Z'),
          message: 'allowed api.example.com',
          logStreamName: `sandbox/egress-proxy/${TASK_ID}`,
        },
      ],
      nextToken: 'tok1',
    });
    const page = await getRunLogs(SUB, AGENT_ID, RUN_ID);
    const cmd = sendMock.mock.calls[0]![0];
    expect(cmd.input.logGroupName).toBe('agent-village-dev-sandbox');
    expect(cmd.input.logStreamNames).toEqual([
      `sandbox/app/${TASK_ID}`,
      `sandbox/egress-proxy/${TASK_ID}`,
    ]);
    expect(page.runStatus).toBe('running');
    expect(page.nextToken).toBe('tok1');
    expect(page.events).toEqual([
      { at: '2026-07-01T12:00:01.000Z', source: 'app', message: 'hello' },
      {
        at: '2026-07-01T12:00:02.000Z',
        source: 'egress-proxy',
        message: 'allowed api.example.com',
      },
    ]);
  });

  it('passes pagination and startTime through to FilterLogEvents', async () => {
    sendMock.mockResolvedValue({ events: [], nextToken: undefined });
    const page = await getRunLogs(SUB, AGENT_ID, RUN_ID, {
      nextToken: 'tokX',
      startTimeMs: 1234,
      limit: 50,
    });
    const cmd = sendMock.mock.calls[0]![0];
    expect(cmd.input.nextToken).toBe('tokX');
    expect(cmd.input.startTime).toBe(1234);
    expect(cmd.input.limit).toBe(50);
    expect(page.nextToken).toBeNull();
  });

  it('is owner-scoped: a non-owned agent surfaces as not found', async () => {
    agentRepoMock.getAgent.mockResolvedValue(null);
    await expect(getRunLogs(SUB, AGENT_ID, RUN_ID)).rejects.toThrow(AgentNotFoundError);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('throws RunNotFoundError for a missing run', async () => {
    runRepoMock.getOne.mockResolvedValue(null);
    await expect(getRunLogs(SUB, AGENT_ID, RUN_ID)).rejects.toThrow(RunNotFoundError);
  });

  it('returns an empty page for inline runs (no sandbox streams)', async () => {
    runRepoMock.getOne.mockResolvedValue({ ...sandboxRun, kind: 'inline', taskArn: null });
    const page = await getRunLogs(SUB, AGENT_ID, RUN_ID);
    expect(page.events).toEqual([]);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns an empty page when the log group/streams do not exist yet', async () => {
    const err = new Error('no such stream');
    err.name = 'ResourceNotFoundException';
    sendMock.mockRejectedValue(err);
    const page = await getRunLogs(SUB, AGENT_ID, RUN_ID);
    expect(page).toEqual({ runStatus: 'running', events: [], nextToken: null });
  });

  it('rethrows other CloudWatch failures', async () => {
    sendMock.mockRejectedValue(new Error('throttled'));
    await expect(getRunLogs(SUB, AGENT_ID, RUN_ID)).rejects.toThrow('throttled');
  });

  it('requires the AV_SANDBOX_LOG_GROUP env var', async () => {
    delete process.env['AV_SANDBOX_LOG_GROUP'];
    await expect(getRunLogs(SUB, AGENT_ID, RUN_ID)).rejects.toThrow('AV_SANDBOX_LOG_GROUP');
  });
});
