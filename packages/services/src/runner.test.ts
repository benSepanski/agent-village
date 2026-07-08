import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentNotFoundError,
  AgentRunInProgressError,
  ReplayPromptMismatchError,
  RunNotFoundError,
  SpendLimitExceededError,
  hashSystemPrompt,
} from '@agent-village/domain';

const { agentRepoMock, runRepoMock, secretsMock, sandboxMock } = vi.hoisted(() => ({
  agentRepoMock: {
    getAgent: vi.fn(),
    getAgentById: vi.fn(),
    reserveSpend: vi.fn(),
    finalizeSpend: vi.fn(),
    acquireActiveRun: vi.fn(),
    releaseActiveRun: vi.fn(),
  },
  runRepoMock: {
    append: vi.fn(),
    getOne: vi.fn(),
    patchRun: vi.fn(),
    sumMonthCost: vi.fn(),
    claimRunReservation: vi.fn(),
  },
  secretsMock: { getAnthropicKey: vi.fn() },
  sandboxMock: { launchSandboxRun: vi.fn() },
}));

vi.mock('@agent-village/data', () => ({
  agentRepo: agentRepoMock,
  runRepo: runRepoMock,
  secrets: secretsMock,
  userRepo: {},
}));

vi.mock('./sandbox.js', () => ({ launchSandboxRun: sandboxMock.launchSandboxRun }));

import { executeRun, monthToDateSpend, setAnthropicFactory } from './runner.js';

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
  runRepoMock.patchRun.mockReset();
  runRepoMock.sumMonthCost.mockReset();
  sandboxMock.launchSandboxRun.mockReset();
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
    // Real (measured) lifecycle events for the timeline (Phase 3 step 07).
    expect(persisted.events.map((e: { event: string }) => e.event)).toEqual([
      'agent.run.started',
      'agent.run.completed',
    ]);
    expect(Date.parse(persisted.events[1].at) - Date.parse(persisted.events[0].at)).toBe(
      persisted.durationMs,
    );
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

describe('executeRun (sandbox)', () => {
  const sandboxAgent = {
    ...agentFixture,
    manifest: {
      name: 'reporter',
      image: 'sandbox-base',
      schedule: null,
      timeoutMinutes: 30,
      egressAllow: [],
      grants: [],
      flushIntervalSeconds: 300,
    },
  };
  const TASK_ARN = 'arn:aws:ecs:us-east-1:0:task/abc';

  it('launches a Fargate task and persists a running sandbox run', async () => {
    agentRepoMock.getAgentById.mockResolvedValue(sandboxAgent);
    agentRepoMock.reserveSpend.mockResolvedValue(undefined);
    agentRepoMock.acquireActiveRun.mockResolvedValue(undefined);
    runRepoMock.append.mockResolvedValue(undefined);
    runRepoMock.patchRun.mockResolvedValue(undefined);
    sandboxMock.launchSandboxRun.mockResolvedValue(TASK_ARN);

    const result = await executeRun({ agentId: AGENT_ID });

    expect(result.status).toBe('running');
    expect(anthropicClient.messages.create).not.toHaveBeenCalled();
    expect(sandboxMock.launchSandboxRun).toHaveBeenCalled();
    const persisted = runRepoMock.append.mock.calls[0]![0];
    expect(persisted.kind).toBe('sandbox');
    expect(persisted.status).toBe('running');
    expect(persisted.model).toBeNull();
    // Honest-cost marker: the flat reservation is stored for the lifecycle
    // handler to reconcile to actual duration.
    expect(persisted.reservedUsd).toBe(persisted.costUsd);
    expect(persisted.reservedUsd).toBeGreaterThan(0);
    expect(persisted.events.map((e: { event: string }) => e.event)).toEqual([
      'sandbox.run.launched',
    ]);
    expect(runRepoMock.patchRun.mock.calls[0]![3]).toEqual({ taskArn: TASK_ARN });
  });

  it('rejects an overlapping run and refunds the reservation', async () => {
    agentRepoMock.getAgentById.mockResolvedValue(sandboxAgent);
    agentRepoMock.reserveSpend.mockResolvedValue(undefined);
    agentRepoMock.acquireActiveRun.mockRejectedValue(new AgentRunInProgressError(AGENT_ID));
    agentRepoMock.finalizeSpend.mockResolvedValue(undefined);

    await expect(executeRun({ agentId: AGENT_ID })).rejects.toBeInstanceOf(AgentRunInProgressError);
    expect(sandboxMock.launchSandboxRun).not.toHaveBeenCalled();
    expect(runRepoMock.append).not.toHaveBeenCalled();
    expect(agentRepoMock.finalizeSpend.mock.calls[0]![0].deltaUsd).toBeLessThan(0);
  });

  it('marks launch_failed, releases the slot, and refunds when RunTask throws', async () => {
    agentRepoMock.getAgentById.mockResolvedValue(sandboxAgent);
    agentRepoMock.reserveSpend.mockResolvedValue(undefined);
    agentRepoMock.acquireActiveRun.mockResolvedValue(undefined);
    agentRepoMock.releaseActiveRun.mockResolvedValue(undefined);
    agentRepoMock.finalizeSpend.mockResolvedValue(undefined);
    runRepoMock.append.mockResolvedValue(undefined);
    runRepoMock.patchRun.mockResolvedValue(undefined);
    const RESERVED = 0.005;
    runRepoMock.claimRunReservation.mockResolvedValue(RESERVED);
    sandboxMock.launchSandboxRun.mockRejectedValue(new Error('capacity'));

    await expect(executeRun({ agentId: AGENT_ID })).rejects.toThrow('capacity');
    const failPatch = runRepoMock.patchRun.mock.calls.find((c) => c[3].status === 'launch_failed');
    expect(failPatch).toBeDefined();
    // The refunded flat estimate must not linger as reported cost (month-to-date
    // sums costUsd).
    expect(failPatch![3]).toMatchObject({ costUsd: 0 });
    expect(agentRepoMock.releaseActiveRun).toHaveBeenCalled();
    // The refund moves exactly the atomically claimed reservation.
    expect(agentRepoMock.finalizeSpend.mock.calls[0]![0].deltaUsd).toBeCloseTo(-RESERVED, 9);
  });

  it('skips the launch-failure refund when the stop event already claimed the reservation', async () => {
    agentRepoMock.getAgentById.mockResolvedValue(sandboxAgent);
    agentRepoMock.reserveSpend.mockResolvedValue(undefined);
    agentRepoMock.acquireActiveRun.mockResolvedValue(undefined);
    agentRepoMock.releaseActiveRun.mockResolvedValue(undefined);
    runRepoMock.append.mockResolvedValue(undefined);
    runRepoMock.patchRun.mockResolvedValue(undefined);
    runRepoMock.claimRunReservation.mockResolvedValue(null); // finalize won the race
    sandboxMock.launchSandboxRun.mockRejectedValue(new Error('capacity'));

    await expect(executeRun({ agentId: AGENT_ID })).rejects.toThrow('capacity');
    expect(agentRepoMock.finalizeSpend).not.toHaveBeenCalled();
  });

  it('records spend_limit_exceeded without acquiring the slot or launching', async () => {
    agentRepoMock.getAgentById.mockResolvedValue(sandboxAgent);
    agentRepoMock.reserveSpend.mockRejectedValue(
      new SpendLimitExceededError({
        agentId: AGENT_ID,
        spendLimitUsd: 1,
        spendUsedUsd: 1,
        estimateUsd: 0.01,
      }),
    );
    runRepoMock.append.mockResolvedValue(undefined);

    const result = await executeRun({ agentId: AGENT_ID });

    expect(result.status).toBe('spend_limit_exceeded');
    expect(agentRepoMock.acquireActiveRun).not.toHaveBeenCalled();
    expect(sandboxMock.launchSandboxRun).not.toHaveBeenCalled();
    expect(runRepoMock.append.mock.calls[0]![0].kind).toBe('sandbox');
  });
});

describe('monthToDateSpend', () => {
  it('is owner-scoped and reports the UTC month with the summed run costs', async () => {
    agentRepoMock.getAgent.mockResolvedValue(agentFixture);
    runRepoMock.sumMonthCost.mockResolvedValue({ costUsd: 0.1234, runCount: 7 });

    const now = new Date('2026-07-04T10:00:00.000Z');
    const spend = await monthToDateSpend(SUB, AGENT_ID, now);

    expect(agentRepoMock.getAgent).toHaveBeenCalledWith(SUB, AGENT_ID);
    expect(runRepoMock.sumMonthCost).toHaveBeenCalledWith(AGENT_ID, now);
    expect(spend).toEqual({ month: '2026-07', costUsd: 0.1234, runCount: 7 });
  });

  it('rejects agents the caller does not own before touching the run table', async () => {
    agentRepoMock.getAgent.mockResolvedValue(null);
    await expect(monthToDateSpend('someone-else', AGENT_ID)).rejects.toBeInstanceOf(
      AgentNotFoundError,
    );
    expect(runRepoMock.sumMonthCost).not.toHaveBeenCalled();
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
