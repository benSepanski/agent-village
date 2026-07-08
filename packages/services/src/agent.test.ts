import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { agentRepoMock, secretsMock, grantSecretsMock, scheduling } = vi.hoisted(() => ({
  agentRepoMock: {
    listMyAgents: vi.fn(),
    getAgent: vi.fn(),
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
    deleteAgent: vi.fn(),
  },
  secretsMock: {
    storeAnthropicKey: vi.fn(),
    rotateAnthropicKey: vi.fn(),
    deleteAnthropicKey: vi.fn(),
  },
  grantSecretsMock: {
    listAgentSecrets: vi.fn(),
    deleteAgentSecret: vi.fn(),
    agentSecretName: (agentId: string, name: string, env: string) =>
      `agent-village/${env}/agents/${agentId}/${name}`,
  },
  scheduling: {
    upsertSchedule: vi.fn(),
    removeSchedule: vi.fn(),
  },
}));

vi.mock('@agent-village/data', () => ({
  agentRepo: agentRepoMock,
  userRepo: {},
  runRepo: {},
  secrets: secretsMock,
  grantSecrets: grantSecretsMock,
}));
vi.mock('./scheduling.js', () => scheduling);

import { AgentNotFoundError } from '@agent-village/domain';
import { createAgent, deleteAgent, getMyAgent, listMyAgents, updateAgent } from './agent.js';

const SUB = 'cog-sub-abc';
const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:0:secret:foo';

const agentFixture = {
  id: AGENT_ID,
  ownerSub: SUB,
  name: 'Daily',
  model: 'claude-opus-4-7',
  systemPrompt: 'You are helpful.',
  schedule: '*/5 * * * *',
  spendLimitUsd: 1,
  spendUsedUsd: 0,
  anthropicSecretArn: SECRET_ARN,
  status: 'active',
  createdAt: '2026-05-16T12:00:00.000Z',
  updatedAt: '2026-05-16T12:00:00.000Z',
};

const createInput = {
  name: 'Daily',
  model: 'claude-opus-4-7' as const,
  systemPrompt: 'You are helpful.',
  schedule: '*/5 * * * *',
  spendLimitUsd: 1,
  anthropicApiKey: 'sk-ant-xxx',
};

beforeEach(() => {
  Object.values(agentRepoMock).forEach((m) => m.mockReset());
  Object.values(secretsMock).forEach((m) => m.mockReset());
  Object.values(scheduling).forEach((m) => m.mockReset());
  grantSecretsMock.listAgentSecrets.mockReset().mockResolvedValue([]);
  grantSecretsMock.deleteAgentSecret.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('listMyAgents / getMyAgent', () => {
  it('forwards listMyAgents', async () => {
    agentRepoMock.listMyAgents.mockResolvedValue([agentFixture]);
    expect(await listMyAgents(SUB)).toEqual([agentFixture]);
  });

  it('returns the agent on getMyAgent', async () => {
    agentRepoMock.getAgent.mockResolvedValue(agentFixture);
    expect((await getMyAgent(SUB, AGENT_ID)).id).toBe(AGENT_ID);
  });

  it('throws AgentNotFoundError when get returns null', async () => {
    agentRepoMock.getAgent.mockResolvedValue(null);
    await expect(getMyAgent(SUB, AGENT_ID)).rejects.toBeInstanceOf(AgentNotFoundError);
  });
});

describe('createAgent', () => {
  it('stores the secret first, then writes the agent, then upserts the schedule', async () => {
    secretsMock.storeAnthropicKey.mockResolvedValue({ arn: SECRET_ARN });
    agentRepoMock.createAgent.mockResolvedValue(undefined);
    scheduling.upsertSchedule.mockResolvedValue(undefined);
    const created = await createAgent(SUB, createInput);
    expect(created.anthropicSecretArn).toBe(SECRET_ARN);
    expect(secretsMock.storeAnthropicKey).toHaveBeenCalledWith(created.id, 'sk-ant-xxx', 'dev');
    expect(scheduling.upsertSchedule).toHaveBeenCalledWith(created.id, '*/5 * * * *');
  });

  it('rolls back the secret when the agent write fails', async () => {
    secretsMock.storeAnthropicKey.mockResolvedValue({ arn: SECRET_ARN });
    agentRepoMock.createAgent.mockRejectedValue(new Error('ddb down'));
    secretsMock.deleteAnthropicKey.mockResolvedValue(undefined);
    await expect(createAgent(SUB, createInput)).rejects.toThrow('ddb down');
    expect(secretsMock.deleteAnthropicKey).toHaveBeenCalledWith(SECRET_ARN);
  });

  it('skips schedule upsert when input has no schedule', async () => {
    secretsMock.storeAnthropicKey.mockResolvedValue({ arn: SECRET_ARN });
    agentRepoMock.createAgent.mockResolvedValue(undefined);
    await createAgent(SUB, { ...createInput, schedule: null });
    expect(scheduling.upsertSchedule).not.toHaveBeenCalled();
  });
});

describe('updateAgent', () => {
  it('rotates the key when anthropicApiKey is in the patch', async () => {
    agentRepoMock.getAgent.mockResolvedValue(agentFixture);
    agentRepoMock.updateAgent.mockResolvedValue(agentFixture);
    await updateAgent(SUB, AGENT_ID, { anthropicApiKey: 'sk-ant-new' });
    expect(secretsMock.rotateAnthropicKey).toHaveBeenCalledWith(SECRET_ARN, 'sk-ant-new');
  });

  it('upserts schedule when schedule changes', async () => {
    agentRepoMock.getAgent.mockResolvedValue(agentFixture);
    agentRepoMock.updateAgent.mockResolvedValue({ ...agentFixture, schedule: '0 12 * * *' });
    await updateAgent(SUB, AGENT_ID, { schedule: '0 12 * * *' });
    expect(scheduling.upsertSchedule).toHaveBeenCalled();
  });

  it('removes the schedule when the agent is paused', async () => {
    agentRepoMock.getAgent.mockResolvedValue(agentFixture);
    agentRepoMock.updateAgent.mockResolvedValue({ ...agentFixture, status: 'paused' });
    await updateAgent(SUB, AGENT_ID, { status: 'paused' });
    expect(scheduling.removeSchedule).toHaveBeenCalled();
  });

  it('throws when the agent is missing', async () => {
    agentRepoMock.getAgent.mockResolvedValue(null);
    await expect(updateAgent(SUB, AGENT_ID, { name: 'X' })).rejects.toBeInstanceOf(
      AgentNotFoundError,
    );
  });

  it('attaches a manifest', async () => {
    const manifest = {
      name: 'summarizer',
      image: '123.dkr.ecr.us-east-1.amazonaws.com/summarizer:latest',
      schedule: null,
      timeoutMinutes: 30,
      egressAllow: ['api.notion.com'],
      grants: [],
      env: {},
      flushIntervalSeconds: 300,
    };
    agentRepoMock.getAgent.mockResolvedValue(agentFixture);
    agentRepoMock.updateAgent.mockResolvedValue({ ...agentFixture, manifest });
    await updateAgent(SUB, AGENT_ID, { manifest });
    expect(agentRepoMock.updateAgent).toHaveBeenCalledWith(
      expect.objectContaining({ patch: expect.objectContaining({ manifest }) }),
    );
  });

  it('detaches a manifest by passing null', async () => {
    agentRepoMock.getAgent.mockResolvedValue(agentFixture);
    agentRepoMock.updateAgent.mockResolvedValue({ ...agentFixture, manifest: null });
    await updateAgent(SUB, AGENT_ID, { manifest: null });
    expect(agentRepoMock.updateAgent).toHaveBeenCalledWith(
      expect.objectContaining({ patch: expect.objectContaining({ manifest: null }) }),
    );
  });
});

describe('deleteAgent', () => {
  it('removes schedule, deletes secret, deletes agent row (keeps runs)', async () => {
    agentRepoMock.getAgent.mockResolvedValue(agentFixture);
    scheduling.removeSchedule.mockResolvedValue(undefined);
    secretsMock.deleteAnthropicKey.mockResolvedValue(undefined);
    agentRepoMock.deleteAgent.mockResolvedValue(undefined);
    await deleteAgent(SUB, AGENT_ID);
    expect(scheduling.removeSchedule).toHaveBeenCalledWith(AGENT_ID);
    expect(secretsMock.deleteAnthropicKey).toHaveBeenCalledWith(SECRET_ARN);
    expect(agentRepoMock.deleteAgent).toHaveBeenCalledWith(SUB, AGENT_ID);
  });

  it('throws when the agent is missing', async () => {
    agentRepoMock.getAgent.mockResolvedValue(null);
    await expect(deleteAgent(SUB, AGENT_ID)).rejects.toBeInstanceOf(AgentNotFoundError);
  });

  it('sweeps every remaining secret under the agent prefix', async () => {
    agentRepoMock.getAgent.mockResolvedValue(agentFixture);
    secretsMock.deleteAnthropicKey.mockResolvedValue(undefined);
    grantSecretsMock.listAgentSecrets.mockResolvedValue(['gmail-app-password', 'notion-token']);
    await deleteAgent(SUB, AGENT_ID);
    expect(grantSecretsMock.listAgentSecrets).toHaveBeenCalledWith(AGENT_ID, 'dev');
    expect(grantSecretsMock.deleteAgentSecret).toHaveBeenCalledWith(
      `agent-village/dev/agents/${AGENT_ID}/gmail-app-password`,
    );
    expect(grantSecretsMock.deleteAgentSecret).toHaveBeenCalledWith(
      `agent-village/dev/agents/${AGENT_ID}/notion-token`,
    );
  });

  it('still deletes the agent row when the secret sweep fails', async () => {
    agentRepoMock.getAgent.mockResolvedValue(agentFixture);
    secretsMock.deleteAnthropicKey.mockResolvedValue(undefined);
    grantSecretsMock.listAgentSecrets.mockRejectedValue(new Error('sm down'));
    await deleteAgent(SUB, AGENT_ID);
    expect(agentRepoMock.deleteAgent).toHaveBeenCalledWith(SUB, AGENT_ID);
  });
});
