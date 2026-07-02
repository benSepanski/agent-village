import { describe, expect, it, vi, beforeEach } from 'vitest';

const { user, agentSvc, runner } = vi.hoisted(() => ({
  user: { ensureProfile: vi.fn() },
  agentSvc: {
    listMyAgents: vi.fn(),
    getMyAgent: vi.fn(),
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
    deleteAgent: vi.fn(),
  },
  runner: {
    executeRun: vi.fn(),
    listForAgent: vi.fn(),
    getRun: vi.fn(),
  },
}));

vi.mock('@agent-village/services', () => ({
  user,
  agent: agentSvc,
  runner,
  scheduling: {},
}));

import { handler as meHandler } from './me.js';
import { handler as listHandler } from './agents-list.js';
import { handler as createHandler } from './agents-create.js';
import { handler as getHandler } from './agents-get.js';
import { handler as updateHandler } from './agents-update.js';
import { handler as deleteHandler } from './agents-delete.js';
import { handler as runNowHandler } from './agents-run-now.js';
import { handler as runsListHandler } from './runs-list.js';
import { handler as runsGetHandler } from './runs-get.js';

const SUB = 'cog-sub-abc';
const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const RUN_ID = '01HZN0PQRSTVWXYZ0123456789';

function evt(over: Record<string, unknown> = {}): never {
  return {
    rawPath: '/test',
    headers: { 'x-amzn-trace-id': 'Root=1' },
    pathParameters: {},
    requestContext: {
      http: { method: 'GET' },
      authorizer: { jwt: { claims: { sub: SUB, email: 'ben@example.com', name: 'Ben' } } },
    },
    ...over,
  } as never;
}

beforeEach(() => {
  user.ensureProfile.mockReset();
  Object.values(agentSvc).forEach((m) => m.mockReset());
  Object.values(runner).forEach((m) => m.mockReset());
});

describe('GET /me', () => {
  it('forwards the JWT claims to user.ensureProfile', async () => {
    user.ensureProfile.mockResolvedValue({ cognitoSub: SUB, email: 'ben@example.com' });
    const res = await meHandler(evt());
    expect(res).toMatchObject({ statusCode: 200 });
    expect(user.ensureProfile).toHaveBeenCalledWith({
      sub: SUB,
      email: 'ben@example.com',
      name: 'Ben',
    });
  });
});

describe('GET /agents', () => {
  it('returns the user agents list', async () => {
    agentSvc.listMyAgents.mockResolvedValue([{ id: AGENT_ID }]);
    const res = await listHandler(evt());
    expect(res).toMatchObject({ statusCode: 200 });
    expect(JSON.parse((res as { body: string }).body).agents[0].id).toBe(AGENT_ID);
  });
});

describe('POST /agents', () => {
  it('parses the body and creates an agent', async () => {
    agentSvc.createAgent.mockResolvedValue({ id: AGENT_ID });
    const res = await createHandler(
      evt({
        body: JSON.stringify({
          name: 'A',
          model: 'claude-opus-4-7',
          systemPrompt: 'hi',
          schedule: '*/5 * * * *',
          spendLimitUsd: 1,
          anthropicApiKey: 'sk-ant-x',
        }),
      }),
    );
    expect(res).toMatchObject({ statusCode: 201 });
    expect(agentSvc.createAgent).toHaveBeenCalled();
  });

  it('returns 400 on invalid body', async () => {
    const res = await createHandler(evt({ body: JSON.stringify({ name: 'A' }) }));
    expect(res).toMatchObject({ statusCode: 400 });
  });
});

describe('GET /agents/{id}', () => {
  it('parses the path parameter and returns the agent', async () => {
    agentSvc.getMyAgent.mockResolvedValue({ id: AGENT_ID });
    const res = await getHandler(evt({ pathParameters: { id: AGENT_ID } }));
    expect(res).toMatchObject({ statusCode: 200 });
  });

  it('returns 400 on invalid agent id', async () => {
    const res = await getHandler(evt({ pathParameters: { id: 'not-a-ulid' } }));
    expect(res).toMatchObject({ statusCode: 400 });
  });
});

describe('PATCH /agents/{id}', () => {
  it('applies the patch', async () => {
    agentSvc.updateAgent.mockResolvedValue({ id: AGENT_ID, name: 'Renamed' });
    const res = await updateHandler(
      evt({ pathParameters: { id: AGENT_ID }, body: JSON.stringify({ name: 'Renamed' }) }),
    );
    expect(res).toMatchObject({ statusCode: 200 });
    expect(agentSvc.updateAgent).toHaveBeenCalled();
  });

  it('parses a manifest body and forwards it to agent.updateAgent', async () => {
    const manifest = {
      name: 'summarizer',
      image: '123.dkr.ecr.us-east-1.amazonaws.com/summarizer:latest',
      schedule: null,
      egressAllow: ['api.notion.com'],
      grants: [],
    };
    agentSvc.updateAgent.mockResolvedValue({ id: AGENT_ID, manifest });
    const res = await updateHandler(
      evt({ pathParameters: { id: AGENT_ID }, body: JSON.stringify({ manifest }) }),
    );
    expect(res).toMatchObject({ statusCode: 200 });
    expect(agentSvc.updateAgent).toHaveBeenCalledWith(
      SUB,
      AGENT_ID,
      expect.objectContaining({ manifest: expect.objectContaining({ name: 'summarizer' }) }),
    );
  });

  it('detaches a manifest with a null body', async () => {
    agentSvc.updateAgent.mockResolvedValue({ id: AGENT_ID, manifest: null });
    const res = await updateHandler(
      evt({ pathParameters: { id: AGENT_ID }, body: JSON.stringify({ manifest: null }) }),
    );
    expect(res).toMatchObject({ statusCode: 200 });
    expect(agentSvc.updateAgent).toHaveBeenCalledWith(SUB, AGENT_ID, { manifest: null });
  });

  it('returns 400 on a malformed manifest body', async () => {
    const res = await updateHandler(
      evt({
        pathParameters: { id: AGENT_ID },
        body: JSON.stringify({ manifest: { name: 'x' } }),
      }),
    );
    expect(res).toMatchObject({ statusCode: 400 });
  });
});

describe('DELETE /agents/{id}', () => {
  it('returns 204 on success', async () => {
    agentSvc.deleteAgent.mockResolvedValue(undefined);
    const res = await deleteHandler(evt({ pathParameters: { id: AGENT_ID } }));
    expect(res).toMatchObject({ statusCode: 204 });
  });
});

describe('POST /agents/{id}/run-now', () => {
  it('triggers executeRun with the parsed flags', async () => {
    runner.executeRun.mockResolvedValue({ runId: RUN_ID, status: 'ok' });
    const res = await runNowHandler(
      evt({ pathParameters: { id: AGENT_ID }, body: JSON.stringify({ dryRun: true }) }),
    );
    expect(res).toMatchObject({ statusCode: 202 });
    expect(runner.executeRun).toHaveBeenCalledWith({
      agentId: AGENT_ID,
      ownerSub: SUB,
      dryRun: true,
    });
  });
});

describe('GET /agents/{id}/runs', () => {
  it('returns the run list', async () => {
    runner.listForAgent.mockResolvedValue([{ id: RUN_ID }]);
    const res = await runsListHandler(evt({ pathParameters: { id: AGENT_ID } }));
    expect(res).toMatchObject({ statusCode: 200 });
  });
});

describe('GET /agents/{id}/runs/{runId}', () => {
  it('returns the run', async () => {
    runner.getRun.mockResolvedValue({ id: RUN_ID });
    const res = await runsGetHandler(evt({ pathParameters: { id: AGENT_ID, runId: RUN_ID } }));
    expect(res).toMatchObject({ statusCode: 200 });
  });

  it('returns 404 when the run is not found', async () => {
    runner.getRun.mockResolvedValue(null);
    const res = await runsGetHandler(evt({ pathParameters: { id: AGENT_ID, runId: RUN_ID } }));
    expect(res).toMatchObject({ statusCode: 404 });
  });
});
