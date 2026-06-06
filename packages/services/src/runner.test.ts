import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentNotFoundError,
  ReplayPromptMismatchError,
  RunNotFoundError,
  SpendLimitExceededError,
  hashSystemPrompt,
} from '@agent-village/domain';

const { agentRepoMock, runRepoMock, secretsMock } = vi.hoisted(() => ({
  agentRepoMock: {
    getAgent: vi.fn(),
    getAgentById: vi.fn(),
    reserveSpend: vi.fn(),
    finalizeSpend: vi.fn(),
  },
  runRepoMock: { append: vi.fn(), getOne: vi.fn() },
  secretsMock: { getAnthropicKey: vi.fn() },
}));

vi.mock('@agent-village/data', () => ({
  agentRepo: agentRepoMock,
  runRepo: runRepoMock,
  secrets: secretsMock,
  userRepo: {},
}));

import { executeRun, setAnthropicFactory } from './runner.js';

const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const ORIG_RUN_ID = '01HZN0PQRSTVWXYZ0123456789';
const SUB = 'cog-sub-abc';
const SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:0:secret:foo';

const agentFixture = {
  id: AGENT_ID,
  ownerSub: SUB,
  name: 'Daily',
  model: 'claude-opus-4-7' as const,
  systemPrompt: 'You are helpful.',
  schedule: '*/5 * * * *',
  spendLimitUsd: 1,
  spendUsedUsd: 0,
  anthropicSecretArn: SECRET_ARN,
  status: 'active' as const,
  createdAt: '2026-05-16T12:00:00.000Z',
  updatedAt: '2026-05-16T12:00:00.000Z',
};

const anthropicResponse = {
  id: 'msg_x',
  model: 'claude-opus-4-7',
  content: [{ type: 'text' as const, text: 'Hello, world.' }],
  usage: { input_tokens: 10, output_tokens: 20 },
};

const anthropicClient = { messages: { create: vi.fn() } };

beforeEach(() => {
  Object.values(agentRepoMock).forEach((m) => m.mockReset());
  runRepoMock.append.mockReset();
  runRepoMock.getOne.mockReset();
  secretsMock.getAnthropicKey.mockReset();
  anthropicClient.messages.create.mockReset();
  setAnthropicFactory(() => anthropicClient as never);
});

afterEach(() => {
  setAnthropicFactory(undefined);
});

describe('executeRun (happy path)', () => {
  it('reserves → fetches → calls → finalizes → persists', async () => {
    agentRepoMock.getAgentById.mockResolvedValue(agentFixture);
    agentRepoMock.reserveSpend.mockResolvedValue(undefined);
    secretsMock.getAnthropicKey.mockResolvedValue('sk-ant-key');
    anthropicClient.messages.create.mockResolvedValue(anthropicResponse);
    agentRepoMock.finalizeSpend.mockResolvedValue(undefined);
    runRepoMock.append.mockResolvedValue(undefined);

    const result = await executeRun({ agentId: AGENT_ID });

    expect(result.status).toBe('ok');
    expect(agentRepoMock.reserveSpend).toHaveBeenCalled();
    expect(secretsMock.getAnthropicKey).toHaveBeenCalledWith(SECRET_ARN);
    expect(anthropicClient.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-opus-4-7', max_tokens: 1024 }),
    );
    expect(agentRepoMock.finalizeSpend).toHaveBeenCalled();
    expect(runRepoMock.append).toHaveBeenCalled();
    const persisted = runRepoMock.append.mock.calls[0]![0];
    expect(persisted.status).toBe('ok');
    expect(persisted.tokensIn).toBe(10);
    expect(persisted.tokensOut).toBe(20);
    expect(persisted.output).toBe('Hello, world.');
  });

  it('caps max_tokens at 256 for dry-run', async () => {
    agentRepoMock.getAgentById.mockResolvedValue(agentFixture);
    agentRepoMock.reserveSpend.mockResolvedValue(undefined);
    secretsMock.getAnthropicKey.mockResolvedValue('sk-ant-key');
    anthropicClient.messages.create.mockResolvedValue(anthropicResponse);
    agentRepoMock.finalizeSpend.mockResolvedValue(undefined);
    runRepoMock.append.mockResolvedValue(undefined);

    await executeRun({ agentId: AGENT_ID, dryRun: true });

    expect(anthropicClient.messages.create.mock.calls[0]![0].max_tokens).toBe(256);
    expect(runRepoMock.append.mock.calls[0]![0].dryRun).toBe(true);
  });
});

describe('executeRun (spend rejection)', () => {
  it('records spend_limit_exceeded without calling Anthropic', async () => {
    agentRepoMock.getAgentById.mockResolvedValue(agentFixture);
    agentRepoMock.reserveSpend.mockRejectedValue(
      new SpendLimitExceededError({
        agentId: AGENT_ID,
        spendLimitUsd: 1,
        spendUsedUsd: 0.99,
        estimateUsd: 0.05,
      }),
    );
    runRepoMock.append.mockResolvedValue(undefined);

    const result = await executeRun({ agentId: AGENT_ID });

    expect(result.status).toBe('spend_limit_exceeded');
    expect(secretsMock.getAnthropicKey).not.toHaveBeenCalled();
    expect(anthropicClient.messages.create).not.toHaveBeenCalled();
    expect(agentRepoMock.finalizeSpend).not.toHaveBeenCalled();
    expect(runRepoMock.append.mock.calls[0]![0].status).toBe('spend_limit_exceeded');
  });
});

describe('executeRun (anthropic error)', () => {
  it('records status=error and still finalizes spend', async () => {
    agentRepoMock.getAgentById.mockResolvedValue(agentFixture);
    agentRepoMock.reserveSpend.mockResolvedValue(undefined);
    secretsMock.getAnthropicKey.mockResolvedValue('sk-ant-key');
    anthropicClient.messages.create.mockRejectedValue(new Error('API down'));
    agentRepoMock.finalizeSpend.mockResolvedValue(undefined);
    runRepoMock.append.mockResolvedValue(undefined);

    const result = await executeRun({ agentId: AGENT_ID });

    expect(result.status).toBe('error');
    expect(agentRepoMock.finalizeSpend).toHaveBeenCalled();
    expect(runRepoMock.append.mock.calls[0]![0].error).toContain('API down');
    expect(runRepoMock.append.mock.calls[0]![0].output).toBeNull();
  });
});

describe('executeRun (ownership)', () => {
  it('loads the agent owner-scoped when ownerSub is provided', async () => {
    agentRepoMock.getAgent.mockResolvedValue(agentFixture);
    agentRepoMock.reserveSpend.mockResolvedValue(undefined);
    secretsMock.getAnthropicKey.mockResolvedValue('sk-ant-key');
    anthropicClient.messages.create.mockResolvedValue(anthropicResponse);
    agentRepoMock.finalizeSpend.mockResolvedValue(undefined);
    runRepoMock.append.mockResolvedValue(undefined);

    await executeRun({ agentId: AGENT_ID, ownerSub: SUB });

    expect(agentRepoMock.getAgent).toHaveBeenCalledWith(SUB, AGENT_ID);
    expect(agentRepoMock.getAgentById).not.toHaveBeenCalled();
  });

  it('rejects a run for an agent the caller does not own', async () => {
    agentRepoMock.getAgent.mockResolvedValue(null);

    await expect(
      executeRun({ agentId: AGENT_ID, ownerSub: 'someone-else' }),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
    expect(agentRepoMock.reserveSpend).not.toHaveBeenCalled();
  });
});

describe('executeRun (reservation refund)', () => {
  it('refunds the reservation when secret fetch throws before finalize', async () => {
    agentRepoMock.getAgentById.mockResolvedValue(agentFixture);
    agentRepoMock.reserveSpend.mockResolvedValue(undefined);
    agentRepoMock.finalizeSpend.mockResolvedValue(undefined);
    secretsMock.getAnthropicKey.mockRejectedValue(new Error('secrets unavailable'));

    await expect(executeRun({ agentId: AGENT_ID })).rejects.toThrow('secrets unavailable');

    expect(agentRepoMock.finalizeSpend).toHaveBeenCalledTimes(1);
    expect(agentRepoMock.finalizeSpend.mock.calls[0]![0].deltaUsd).toBeLessThan(0);
    expect(runRepoMock.append).not.toHaveBeenCalled();
  });
});

describe('executeRun (replay)', () => {
  const okResponseSetup = (): void => {
    agentRepoMock.getAgentById.mockResolvedValue(agentFixture);
    agentRepoMock.reserveSpend.mockResolvedValue(undefined);
    secretsMock.getAnthropicKey.mockResolvedValue('sk-ant-key');
    anthropicClient.messages.create.mockResolvedValue(anthropicResponse);
    agentRepoMock.finalizeSpend.mockResolvedValue(undefined);
    runRepoMock.append.mockResolvedValue(undefined);
  };

  it('records lineage when the original prompt still matches', async () => {
    okResponseSetup();
    runRepoMock.getOne.mockResolvedValue({
      id: ORIG_RUN_ID,
      systemPromptHash: hashSystemPrompt(agentFixture.systemPrompt),
    });

    await executeRun({ agentId: AGENT_ID, replayOfRunId: ORIG_RUN_ID });

    expect(runRepoMock.getOne).toHaveBeenCalledWith(AGENT_ID, ORIG_RUN_ID);
    expect(runRepoMock.append.mock.calls[0]![0].replayOfRunId).toBe(ORIG_RUN_ID);
  });

  it('throws when the original run no longer exists', async () => {
    agentRepoMock.getAgentById.mockResolvedValue(agentFixture);
    runRepoMock.getOne.mockResolvedValue(null);

    await expect(
      executeRun({ agentId: AGENT_ID, replayOfRunId: ORIG_RUN_ID }),
    ).rejects.toBeInstanceOf(RunNotFoundError);
    expect(agentRepoMock.reserveSpend).not.toHaveBeenCalled();
  });

  it('throws when the system prompt has changed since the original run', async () => {
    agentRepoMock.getAgentById.mockResolvedValue(agentFixture);
    runRepoMock.getOne.mockResolvedValue({
      id: ORIG_RUN_ID,
      systemPromptHash: 'sha256:stale',
    });

    await expect(
      executeRun({ agentId: AGENT_ID, replayOfRunId: ORIG_RUN_ID }),
    ).rejects.toBeInstanceOf(ReplayPromptMismatchError);
    expect(agentRepoMock.reserveSpend).not.toHaveBeenCalled();
  });
});
