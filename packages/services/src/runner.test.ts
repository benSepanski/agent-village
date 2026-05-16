import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpendLimitExceededError } from '@agent-village/domain';

const { agentRepoMock, runRepoMock, secretsMock } = vi.hoisted(() => ({
  agentRepoMock: {
    getAgentById: vi.fn(),
    reserveSpend: vi.fn(),
    finalizeSpend: vi.fn(),
  },
  runRepoMock: { append: vi.fn() },
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
