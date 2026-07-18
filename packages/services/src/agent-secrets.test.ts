import { beforeEach, describe, expect, it, vi } from 'vitest';

const { agentRepoMock, grantSecretsMock } = vi.hoisted(() => ({
  agentRepoMock: {
    getAgent: vi.fn(),
  },
  grantSecretsMock: {
    storeAgentSecret: vi.fn(),
    listAgentSecrets: vi.fn(),
    deleteAgentSecret: vi.fn(),
    agentSecretName: (agentId: string, name: string, env: string) =>
      `agent-village/${env}/agents/${agentId}/${name}`,
  },
}));

vi.mock('@agent-village/data', () => ({
  agentRepo: agentRepoMock,
  userRepo: {},
  runRepo: {},
  secrets: {},
  grantSecrets: grantSecretsMock,
}));

import { AgentNotFoundError, SecretPendingDeletionError } from '@agent-village/domain';
import { ZodError } from '@agent-village/shared';
import { deleteAgentSecret, listAgentSecrets, setAgentSecret } from './agent-secrets.js';

const SUB = 'cog-sub-abc';
const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const ARN = `arn:aws:secretsmanager:us-east-1:0:secret:agent-village/dev/agents/${AGENT_ID}/gmail-app-password-AbCdEf`;

beforeEach(() => {
  agentRepoMock.getAgent.mockReset().mockResolvedValue({ id: AGENT_ID, ownerSub: SUB });
  grantSecretsMock.storeAgentSecret.mockReset().mockResolvedValue({ arn: ARN });
  grantSecretsMock.listAgentSecrets.mockReset().mockResolvedValue([]);
  grantSecretsMock.deleteAgentSecret.mockReset().mockResolvedValue(undefined);
});

describe('setAgentSecret', () => {
  it('stores the value under the agent env and returns name + arn only', async () => {
    const res = await setAgentSecret(SUB, AGENT_ID, 'gmail-app-password', 's3cret');
    expect(res).toEqual({ name: 'gmail-app-password', arn: ARN });
    expect(grantSecretsMock.storeAgentSecret).toHaveBeenCalledWith(
      AGENT_ID,
      'gmail-app-password',
      's3cret',
      'dev',
    );
  });

  it('proves ownership before touching Secrets Manager', async () => {
    agentRepoMock.getAgent.mockResolvedValue(null);
    await expect(
      setAgentSecret(SUB, AGENT_ID, 'gmail-app-password', 's3cret'),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
    expect(agentRepoMock.getAgent).toHaveBeenCalledWith(SUB, AGENT_ID);
    expect(grantSecretsMock.storeAgentSecret).not.toHaveBeenCalled();
  });

  it('rejects a reserved platform leaf (metering-gateway bypass)', async () => {
    await expect(setAgentSecret(SUB, AGENT_ID, 'anthropic-key', 'sk-ant-x')).rejects.toBeInstanceOf(
      ZodError,
    );
    expect(grantSecretsMock.storeAgentSecret).not.toHaveBeenCalled();
  });

  it('rejects a non-kebab-case name', async () => {
    await expect(setAgentSecret(SUB, AGENT_ID, 'Not Valid!', 'x')).rejects.toBeInstanceOf(ZodError);
    expect(grantSecretsMock.storeAgentSecret).not.toHaveBeenCalled();
  });

  it('surfaces scheduled-for-deletion as a 409 domain error', async () => {
    grantSecretsMock.storeAgentSecret.mockRejectedValue(
      Object.assign(new Error('secret is scheduled for deletion'), {
        name: 'InvalidRequestException',
      }),
    );
    await expect(setAgentSecret(SUB, AGENT_ID, 'gmail-app-password', 'x')).rejects.toBeInstanceOf(
      SecretPendingDeletionError,
    );
  });
});

describe('listAgentSecrets', () => {
  it('lists user leaves and hides platform-managed ones', async () => {
    grantSecretsMock.listAgentSecrets.mockResolvedValue([
      'anthropic-key',
      'gmail-app-password',
      'notion-token',
    ]);
    expect(await listAgentSecrets(SUB, AGENT_ID)).toEqual(['gmail-app-password']);
    expect(grantSecretsMock.listAgentSecrets).toHaveBeenCalledWith(AGENT_ID, 'dev');
  });

  it('throws AgentNotFoundError for an agent the caller does not own', async () => {
    agentRepoMock.getAgent.mockResolvedValue(null);
    await expect(listAgentSecrets(SUB, AGENT_ID)).rejects.toBeInstanceOf(AgentNotFoundError);
    expect(grantSecretsMock.listAgentSecrets).not.toHaveBeenCalled();
  });
});

describe('deleteAgentSecret', () => {
  it('derives the full name under the agent prefix', async () => {
    await deleteAgentSecret(SUB, AGENT_ID, 'gmail-app-password');
    expect(grantSecretsMock.deleteAgentSecret).toHaveBeenCalledWith(
      `agent-village/dev/agents/${AGENT_ID}/gmail-app-password`,
    );
  });

  it('refuses to delete a reserved platform leaf', async () => {
    await expect(deleteAgentSecret(SUB, AGENT_ID, 'anthropic-key')).rejects.toBeInstanceOf(
      ZodError,
    );
    expect(grantSecretsMock.deleteAgentSecret).not.toHaveBeenCalled();
  });

  it('throws AgentNotFoundError for an agent the caller does not own', async () => {
    agentRepoMock.getAgent.mockResolvedValue(null);
    await expect(deleteAgentSecret(SUB, AGENT_ID, 'gmail-app-password')).rejects.toBeInstanceOf(
      AgentNotFoundError,
    );
    expect(grantSecretsMock.deleteAgentSecret).not.toHaveBeenCalled();
  });
});
