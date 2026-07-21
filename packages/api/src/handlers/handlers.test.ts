import { describe, expect, it, vi, beforeEach } from 'vitest';

const { user, budgetSvc, agentSvc, agentSecretsSvc, runner, workspaceSvc } = vi.hoisted(() => ({
  user: { ensureProfile: vi.fn() },
  budgetSvc: {
    getBudgetStatus: vi.fn(),
    updateUserBudget: vi.fn(),
  },
  agentSvc: {
    listMyAgents: vi.fn(),
    getMyAgent: vi.fn(),
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
    deleteAgent: vi.fn(),
  },
  agentSecretsSvc: {
    setAgentSecret: vi.fn(),
    listAgentSecrets: vi.fn(),
    deleteAgentSecret: vi.fn(),
  },
  runner: {
    executeRun: vi.fn(),
    listForAgent: vi.fn(),
    getRun: vi.fn(),
    getRunLogs: vi.fn(),
    monthToDateSpend: vi.fn(),
  },
  workspaceSvc: {
    listWorkspace: vi.fn(),
    presignWorkspace: vi.fn(),
  },
}));

vi.mock('@agent-village/services', () => ({
  user,
  budget: budgetSvc,
  agent: agentSvc,
  agentSecrets: agentSecretsSvc,
  runner,
  workspace: workspaceSvc,
  scheduling: {},
}));

import { handler as meHandler } from './me.js';
import { handler as meBudgetHandler } from './me-budget.js';
import { handler as meBudgetUpdateHandler } from './me-budget-update.js';
import { handler as listHandler } from './agents-list.js';
import { handler as createHandler } from './agents-create.js';
import { handler as getHandler } from './agents-get.js';
import { handler as updateHandler } from './agents-update.js';
import { handler as deleteHandler } from './agents-delete.js';
import { handler as runNowHandler } from './agents-run-now.js';
import { handler as runsListHandler } from './runs-list.js';
import { handler as runsGetHandler } from './runs-get.js';
import { handler as runsLogsHandler } from './runs-logs.js';
import { handler as agentsSpendHandler } from './agents-spend.js';
import { handler as secretsSetHandler } from './agents-secrets-set.js';
import { handler as secretsListHandler } from './agents-secrets-list.js';
import { handler as secretsDeleteHandler } from './agents-secrets-delete.js';
import { handler as workspaceListHandler } from './agents-workspace-list.js';
import { handler as workspacePresignHandler } from './agents-workspace-presign.js';

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
  Object.values(budgetSvc).forEach((m) => m.mockReset());
  Object.values(agentSvc).forEach((m) => m.mockReset());
  Object.values(agentSecretsSvc).forEach((m) => m.mockReset());
  Object.values(runner).forEach((m) => m.mockReset());
  Object.values(workspaceSvc).forEach((m) => m.mockReset());
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

describe('GET /me/budget', () => {
  it('returns the owner-scoped budget status', async () => {
    const status = {
      month: '2026-07',
      limitUsd: 50,
      usedUsd: 12.5,
      remainingUsd: 37.5,
      agents: [{ agentId: AGENT_ID, name: 'Daily', spendLimitUsd: 1, spendUsedUsd: 0.2 }],
    };
    budgetSvc.getBudgetStatus.mockResolvedValue(status);
    const res = await meBudgetHandler(evt());
    expect(res).toMatchObject({ statusCode: 200 });
    expect(budgetSvc.getBudgetStatus).toHaveBeenCalledWith(SUB);
    expect(JSON.parse((res as { body: string }).body)).toEqual(status);
  });

  it('returns 404 when the service reports the profile is missing', async () => {
    budgetSvc.getBudgetStatus.mockRejectedValue(
      Object.assign(new Error(`user not found: ${SUB}`), { statusCode: 404 }),
    );
    const res = await meBudgetHandler(evt());
    expect(res).toMatchObject({ statusCode: 404 });
  });
});

describe('PATCH /me/budget', () => {
  it('sets the cap and returns the updated profile', async () => {
    budgetSvc.updateUserBudget.mockResolvedValue({
      cognitoSub: SUB,
      email: 'ben@example.com',
      displayName: 'Ben',
      userMonthlyBudgetUsd: 25,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const res = await meBudgetUpdateHandler(
      evt({ body: JSON.stringify({ userMonthlyBudgetUsd: 25 }) }),
    );
    expect(res).toMatchObject({ statusCode: 200 });
    expect(budgetSvc.updateUserBudget).toHaveBeenCalledWith(SUB, { userMonthlyBudgetUsd: 25 });
    expect(JSON.parse((res as { body: string }).body).userMonthlyBudgetUsd).toBe(25);
  });

  it('clears the cap with an explicit null', async () => {
    budgetSvc.updateUserBudget.mockResolvedValue({
      cognitoSub: SUB,
      email: 'ben@example.com',
      displayName: 'Ben',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const res = await meBudgetUpdateHandler(
      evt({ body: JSON.stringify({ userMonthlyBudgetUsd: null }) }),
    );
    expect(res).toMatchObject({ statusCode: 200 });
    expect(budgetSvc.updateUserBudget).toHaveBeenCalledWith(SUB, { userMonthlyBudgetUsd: null });
  });

  it('returns 400 on a non-positive budget', async () => {
    const res = await meBudgetUpdateHandler(
      evt({ body: JSON.stringify({ userMonthlyBudgetUsd: 0 }) }),
    );
    expect(res).toMatchObject({ statusCode: 400 });
    expect(budgetSvc.updateUserBudget).not.toHaveBeenCalled();
  });

  it('returns 400 (not 500) on a malformed JSON body', async () => {
    const res = await meBudgetUpdateHandler(evt({ body: '{"userMonthlyBudgetUsd":' }));
    expect(res).toMatchObject({ statusCode: 400 });
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

  it('returns 400 (not 500) on a malformed JSON body', async () => {
    const res = await createHandler(evt({ body: '{"name":' }));
    expect(res).toMatchObject({ statusCode: 400 });
    expect(JSON.parse((res as { body: string }).body).error).toBe('invalid input');
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
      image: 'summarizer',
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

describe('GET /agents/{id}/spend', () => {
  it('returns the owner-scoped month-to-date summary', async () => {
    runner.monthToDateSpend.mockResolvedValue({ month: '2026-07', costUsd: 0.12, runCount: 3 });
    const res = await agentsSpendHandler(evt({ pathParameters: { id: AGENT_ID } }));
    expect(res).toMatchObject({ statusCode: 200 });
    expect(runner.monthToDateSpend).toHaveBeenCalledWith(SUB, AGENT_ID);
    expect(JSON.parse((res as { body: string }).body)).toEqual({
      month: '2026-07',
      costUsd: 0.12,
      runCount: 3,
    });
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

describe('GET /agents/{id}/runs/{runId}/logs', () => {
  const page = {
    runStatus: 'running',
    events: [{ at: '2026-07-01T12:00:01.000Z', source: 'app', message: 'hello' }],
    nextToken: 'tok1',
  };

  it('returns one owner-scoped page of log events', async () => {
    runner.getRunLogs.mockResolvedValue(page);
    const res = await runsLogsHandler(evt({ pathParameters: { id: AGENT_ID, runId: RUN_ID } }));
    expect(res).toMatchObject({ statusCode: 200 });
    expect(runner.getRunLogs).toHaveBeenCalledWith(SUB, AGENT_ID, RUN_ID, {});
    expect(JSON.parse((res as { body: string }).body)).toEqual(page);
  });

  it('parses pagination query parameters through to the service', async () => {
    runner.getRunLogs.mockResolvedValue({ ...page, nextToken: null });
    const res = await runsLogsHandler(
      evt({
        pathParameters: { id: AGENT_ID, runId: RUN_ID },
        queryStringParameters: { nextToken: 'tokX', startTime: '1234', limit: '50' },
      }),
    );
    expect(res).toMatchObject({ statusCode: 200 });
    expect(runner.getRunLogs).toHaveBeenCalledWith(SUB, AGENT_ID, RUN_ID, {
      nextToken: 'tokX',
      startTimeMs: 1234,
      limit: 50,
    });
  });

  it('returns 400 on a malformed query parameter', async () => {
    const res = await runsLogsHandler(
      evt({
        pathParameters: { id: AGENT_ID, runId: RUN_ID },
        queryStringParameters: { startTime: 'not-a-number' },
      }),
    );
    expect(res).toMatchObject({ statusCode: 400 });
    expect(runner.getRunLogs).not.toHaveBeenCalled();
  });

  it('returns 400 on an invalid run id', async () => {
    const res = await runsLogsHandler(evt({ pathParameters: { id: AGENT_ID, runId: 'nope' } }));
    expect(res).toMatchObject({ statusCode: 400 });
  });
});

describe('POST /agents/{id}/secrets', () => {
  const ARN = `arn:aws:secretsmanager:us-east-1:0:secret:agent-village/dev/agents/${AGENT_ID}/gmail-app-password-AbCdEf`;

  it('stores the secret and responds with name + arn, never the value', async () => {
    agentSecretsSvc.setAgentSecret.mockResolvedValue({ name: 'gmail-app-password', arn: ARN });
    const res = await secretsSetHandler(
      evt({
        pathParameters: { id: AGENT_ID },
        body: JSON.stringify({ name: 'gmail-app-password', value: 's3cret-value' }),
      }),
    );
    expect(res).toMatchObject({ statusCode: 200 });
    expect(agentSecretsSvc.setAgentSecret).toHaveBeenCalledWith(
      SUB,
      AGENT_ID,
      'gmail-app-password',
      's3cret-value',
    );
    const body = (res as { body: string }).body;
    expect(JSON.parse(body)).toEqual({ name: 'gmail-app-password', arn: ARN });
    expect(body).not.toContain('s3cret-value');
  });

  it('returns 400 on a reserved platform leaf without calling the service', async () => {
    const res = await secretsSetHandler(
      evt({
        pathParameters: { id: AGENT_ID },
        body: JSON.stringify({ name: 'anthropic-key', value: 'sk-ant-x' }),
      }),
    );
    expect(res).toMatchObject({ statusCode: 400 });
    expect(agentSecretsSvc.setAgentSecret).not.toHaveBeenCalled();
  });

  it('returns 400 on a non-kebab-case name and never echoes the value', async () => {
    const res = await secretsSetHandler(
      evt({
        pathParameters: { id: AGENT_ID },
        body: JSON.stringify({ name: 'Not Valid!', value: 's3cret-value' }),
      }),
    );
    expect(res).toMatchObject({ statusCode: 400 });
    expect((res as { body: string }).body).not.toContain('s3cret-value');
    expect(agentSecretsSvc.setAgentSecret).not.toHaveBeenCalled();
  });
});

describe('GET /agents/{id}/secrets', () => {
  it('returns the secret names', async () => {
    agentSecretsSvc.listAgentSecrets.mockResolvedValue(['gmail-app-password']);
    const res = await secretsListHandler(evt({ pathParameters: { id: AGENT_ID } }));
    expect(res).toMatchObject({ statusCode: 200 });
    expect(agentSecretsSvc.listAgentSecrets).toHaveBeenCalledWith(SUB, AGENT_ID);
    expect(JSON.parse((res as { body: string }).body)).toEqual({
      secrets: ['gmail-app-password'],
    });
  });

  it('returns 404 when the service reports the agent is not owned', async () => {
    agentSecretsSvc.listAgentSecrets.mockRejectedValue(
      Object.assign(new Error(`agent not found: ${AGENT_ID}`), { statusCode: 404 }),
    );
    const res = await secretsListHandler(evt({ pathParameters: { id: AGENT_ID } }));
    expect(res).toMatchObject({ statusCode: 404 });
  });
});

describe('DELETE /agents/{id}/secrets/{name}', () => {
  it('returns 204 on success', async () => {
    agentSecretsSvc.deleteAgentSecret.mockResolvedValue(undefined);
    const res = await secretsDeleteHandler(
      evt({ pathParameters: { id: AGENT_ID, name: 'gmail-app-password' } }),
    );
    expect(res).toMatchObject({ statusCode: 204 });
    expect(agentSecretsSvc.deleteAgentSecret).toHaveBeenCalledWith(
      SUB,
      AGENT_ID,
      'gmail-app-password',
    );
  });

  it('returns 400 on a reserved leaf without calling the service', async () => {
    const res = await secretsDeleteHandler(
      evt({ pathParameters: { id: AGENT_ID, name: 'anthropic-key' } }),
    );
    expect(res).toMatchObject({ statusCode: 400 });
    expect(agentSecretsSvc.deleteAgentSecret).not.toHaveBeenCalled();
  });
});

describe('GET /agents/{id}/workspace', () => {
  it('returns the listing', async () => {
    const listing = {
      entries: [{ path: 'notes.md', size: 12, lastModified: '2026-07-18T00:00:00.000Z' }],
      truncated: false,
    };
    workspaceSvc.listWorkspace.mockResolvedValue(listing);
    const res = await workspaceListHandler(evt({ pathParameters: { id: AGENT_ID } }));
    expect(res).toMatchObject({ statusCode: 200 });
    expect(workspaceSvc.listWorkspace).toHaveBeenCalledWith(SUB, AGENT_ID);
    expect(JSON.parse((res as { body: string }).body)).toEqual(listing);
  });

  it('returns 400 on an invalid agent id', async () => {
    const res = await workspaceListHandler(evt({ pathParameters: { id: 'not-a-ulid' } }));
    expect(res).toMatchObject({ statusCode: 400 });
    expect(workspaceSvc.listWorkspace).not.toHaveBeenCalled();
  });

  it('returns 404 when the service reports the agent is not owned', async () => {
    workspaceSvc.listWorkspace.mockRejectedValue(
      Object.assign(new Error(`agent not found: ${AGENT_ID}`), { statusCode: 404 }),
    );
    const res = await workspaceListHandler(evt({ pathParameters: { id: AGENT_ID } }));
    expect(res).toMatchObject({ statusCode: 404 });
  });
});

describe('POST /agents/{id}/workspace/presign', () => {
  const presigned = {
    urls: [
      {
        path: 'notes.md',
        op: 'get',
        url: 'https://example/signed',
        expiresAt: '2026-07-18T00:15:00.000Z',
      },
    ],
  };

  it('parses the body and forwards it to workspace.presignWorkspace', async () => {
    workspaceSvc.presignWorkspace.mockResolvedValue(presigned);
    const res = await workspacePresignHandler(
      evt({
        pathParameters: { id: AGENT_ID },
        body: JSON.stringify({ files: [{ path: 'notes.md', op: 'get' }] }),
      }),
    );
    expect(res).toMatchObject({ statusCode: 200 });
    expect(workspaceSvc.presignWorkspace).toHaveBeenCalledWith(SUB, AGENT_ID, {
      files: [{ path: 'notes.md', op: 'get' }],
    });
    expect(JSON.parse((res as { body: string }).body)).toEqual(presigned);
  });

  it('returns 400 on an empty files array without calling the service', async () => {
    const res = await workspacePresignHandler(
      evt({ pathParameters: { id: AGENT_ID }, body: JSON.stringify({ files: [] }) }),
    );
    expect(res).toMatchObject({ statusCode: 400 });
    expect(workspaceSvc.presignWorkspace).not.toHaveBeenCalled();
  });

  it('returns 400 on a traversal path without calling the service', async () => {
    const res = await workspacePresignHandler(
      evt({
        pathParameters: { id: AGENT_ID },
        body: JSON.stringify({ files: [{ path: '../escape', op: 'get' }] }),
      }),
    );
    expect(res).toMatchObject({ statusCode: 400 });
    expect(workspaceSvc.presignWorkspace).not.toHaveBeenCalled();
  });

  it('returns 400 (not 500) on a malformed JSON body', async () => {
    const res = await workspacePresignHandler(
      evt({ pathParameters: { id: AGENT_ID }, body: '{"files":' }),
    );
    expect(res).toMatchObject({ statusCode: 400 });
  });
});
