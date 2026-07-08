import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunTaskCommand } from '@aws-sdk/client-ecs';
import { CreateScheduleCommand, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import {
  actualCost,
  actualSandboxCost,
  estimateGatewayCall,
  estimateSandboxCost,
} from '@agent-village/domain';
import { AgentId, RunId } from '@agent-village/shared';
import type { Agent, ApplicationManifest, Run } from '@agent-village/shared';

/**
 * Phase 3 step 09 — acceptance scenarios, AWS-free. Unlike the per-module unit
 * tests, these run the REAL launcher, metering gateway, and lifecycle handler
 * together against one faithful in-memory data layer (conditional spend
 * reservation, run patching, atomic usage ADDs) with only the AWS clients
 * (ECS/STS/Scheduler) and the Anthropic upstream faked. The invariants under
 * test are the phase's acceptance criteria in miniature:
 *
 *  1. Spend breach: with a low spendLimitUsd the gateway starts 402-ing
 *     mid-run, the run record transitions to spend_limit_exceeded, and after
 *     the task stops the run shows ACTUAL (reconciled) cost — never the flat
 *     launch-time estimate — equal to what the agent ledger was charged.
 *  2. Timeout kill: the launcher arms a StopTask watchdog at
 *     timeoutMinutes + grace and injects AV_TIMEOUT_SECONDS into the app
 *     container; a watchdog-stopped task finalizes as timed_out at actual
 *     cost, the schedule's self-delete race is tolerated, and the run's
 *     gateway token dies with it.
 */

// ---------------------------------------------------------------------------
// In-memory data layer: same semantics as packages/data's DynamoDB repos.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  ledger: { spendLimitUsd: 10, spendUsedUsd: 0, activeRunId: null as string | null },
  runs: new Map<string, Run>(),
  agent: null as unknown,
}));

vi.mock('@agent-village/data', async () => {
  const domain = await import('@agent-village/domain');
  const getRun = (agentId: string, runId: string): Run => {
    const run = state.runs.get(runId);
    if (!run) throw new domain.RunNotFoundError(agentId, runId);
    return run;
  };
  const agentRepo = {
    getAgentById: () => Promise.resolve(state.agent),
    // Conditional ADD, exactly like agents.ts: spendUsedUsd + estimate <= limit.
    reserveSpend: (input: { agentId: string; estimateUsd: number }) => {
      const { ledger } = state;
      if (ledger.spendUsedUsd + input.estimateUsd > ledger.spendLimitUsd) {
        return Promise.reject(
          new domain.SpendLimitExceededError({
            agentId: input.agentId,
            spendLimitUsd: ledger.spendLimitUsd,
            spendUsedUsd: ledger.spendUsedUsd,
            estimateUsd: input.estimateUsd,
          }),
        );
      }
      ledger.spendUsedUsd += input.estimateUsd;
      return Promise.resolve();
    },
    finalizeSpend: (input: { deltaUsd: number }) => {
      state.ledger.spendUsedUsd += input.deltaUsd;
      return Promise.resolve();
    },
    acquireActiveRun: (input: { agentId: string; runId: string }) => {
      if (state.ledger.activeRunId !== null) {
        return Promise.reject(new domain.AgentRunInProgressError(input.agentId));
      }
      state.ledger.activeRunId = input.runId;
      return Promise.resolve();
    },
    releaseActiveRun: (input: { runId: string }) => {
      if (state.ledger.activeRunId === input.runId) state.ledger.activeRunId = null;
      return Promise.resolve();
    },
  };
  const runRepo = {
    append: (run: Run) => {
      state.runs.set(run.id, structuredClone(run));
      return Promise.resolve();
    },
    // Clones on read: callers must not be able to mutate the store in place.
    getOne: (_agentId: string, runId: string) =>
      Promise.resolve(structuredClone(state.runs.get(runId) ?? null)),
    patchRun: (agentId: string, _createdAt: string, runId: string, patch: object) => {
      const run = getRun(agentId, runId) as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) run[key] = value;
      }
      return Promise.resolve(structuredClone(run));
    },
    // Conditional claim-and-clear, like runs.ts claimRunReservation: hands the
    // reserved amount to exactly one caller.
    claimRunReservation: (agentId: string, _createdAt: string, runId: string) => {
      const run = getRun(agentId, runId) as unknown as Record<string, unknown>;
      const prior = run['reservedUsd'];
      run['reservedUsd'] = null;
      return Promise.resolve(typeof prior === 'number' ? prior : null);
    },
    // Atomic ADD semantics, like runs.ts addRunUsage.
    addRunUsage: (
      agentId: string,
      _createdAt: string,
      runId: string,
      delta: { costUsd: number; tokensIn: number; tokensOut: number },
    ) => {
      const run = getRun(agentId, runId);
      run.costUsd += delta.costUsd;
      run.tokensIn += delta.tokensIn;
      run.tokensOut += delta.tokensOut;
      return Promise.resolve();
    },
  };
  return {
    agentRepo,
    runRepo,
    secrets: { getAnthropicKey: () => Promise.resolve('sk-ant-platform-key') },
    grantSecrets: {},
    userRepo: {},
  };
});

import { executeSandboxRun } from './runner-sandbox.js';
import {
  handleGatewayRequest,
  resetGatewayKeyCache,
  setGatewayFetch,
  type GatewayRequest,
} from './anthropic-gateway.js';
import { finalizeSandboxRun } from './sandbox-lifecycle.js';
import { setEcsClient, setStsClient } from './sandbox.js';
import { resetSchedulerClient, setSchedulerClient } from './scheduling.js';
import { WATCHDOG_GRACE_MINUTES, watchdogScheduleName } from './sandbox-watchdog.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AGENT_ID = AgentId.parse('01HZ1234567890ABCDEFGHJKMN');
const RUN_ID = RunId.parse('01HZN0PQRSTVWXYZ0123456789');
const SUB = 'cog-sub-abc';
const MODEL = 'claude-sonnet-4-6';
const TIMEOUT_MINUTES = 10;
const TASK_ARN = 'arn:aws:ecs:us-east-1:0:task/abc';
// Default sandbox task size (AV_SANDBOX_CPU / AV_SANDBOX_MEMORY unset).
const TASK_CPU = 256;
const TASK_MEM_MB = 512;

const SANDBOX_ENV = {
  AV_SANDBOX_CLUSTER_ARN: 'arn:aws:ecs:us-east-1:0:cluster/agent-village-dev-sandbox',
  AV_SANDBOX_TASKDEF_ARN: 'arn:aws:ecs:us-east-1:0:task-definition/agent-village-dev-sandbox:1',
  AV_SANDBOX_TASK_ROLE_ARN: 'arn:aws:iam::0:role/task',
  AV_SANDBOX_SUBNET_IDS: 'subnet-a,subnet-b',
  AV_SANDBOX_SECURITY_GROUP: 'sg-123',
  AV_WORKSPACE_BUCKET: 'workspace-bucket',
  AV_REGION: 'us-east-1',
  AV_ENV: 'dev',
  AV_WATCHDOG_GROUP: 'agent-village-dev-run-watchdogs',
  AV_WATCHDOG_ROLE_ARN: 'arn:aws:iam::0:role/agent-village-dev-run-watchdog',
  AV_GATEWAY_URL: 'https://gw123.lambda-url.us-east-1.on.aws/',
};

const manifest: ApplicationManifest = {
  name: 'acceptance-app',
  image: 'acct.dkr.ecr.us-east-1.amazonaws.com/sandbox-base:latest',
  command: ['node', '/workspace/app.mjs'],
  schedule: null,
  timeoutMinutes: TIMEOUT_MINUTES,
  egressAllow: [],
  grants: [],
  flushIntervalSeconds: 0,
};

const agent = {
  id: AGENT_ID,
  ownerSub: SUB,
  anthropicSecretArn: 'arn:aws:secretsmanager:us-east-1:0:secret:platform-anthropic-key',
  manifest,
} as unknown as Agent;

const ctx = { agentId: AGENT_ID, runId: RUN_ID, traceId: 'trace-e2e', startedAt: Date.now() };

const FLAT_ESTIMATE = estimateSandboxCost(TIMEOUT_MINUTES, TASK_CPU, TASK_MEM_MB);
const gatewayBody = JSON.stringify({
  model: MODEL,
  max_tokens: 400,
  messages: [{ role: 'user', content: 'draft a reply' }],
});
const CALL_ESTIMATE = estimateGatewayCall(MODEL, 400, gatewayBody.length);
const USAGE = { inputTokens: 100, outputTokens: 40 };
const CALL_ACTUAL = actualCost(MODEL, USAGE);

const upstreamBody = JSON.stringify({
  id: 'msg_1',
  content: [{ type: 'text', text: 'hi' }],
  usage: { input_tokens: USAGE.inputTokens, output_tokens: USAGE.outputTokens },
});

const ecsSend = vi.fn();
const stsSend = vi.fn();
const schedulerSend = vi.fn();
const fetchMock = vi.fn();

beforeEach(() => {
  Object.assign(process.env, SANDBOX_ENV);
  delete process.env['AV_SANDBOX_CPU'];
  delete process.env['AV_SANDBOX_MEMORY'];
  state.ledger.spendLimitUsd = 10;
  state.ledger.spendUsedUsd = 0;
  state.ledger.activeRunId = null;
  state.runs.clear();
  state.agent = agent;
  setEcsClient({ send: ecsSend } as never);
  setStsClient({ send: stsSend } as never);
  setSchedulerClient({ send: schedulerSend } as never);
  ecsSend.mockReset().mockResolvedValue({ tasks: [{ taskArn: TASK_ARN }] });
  stsSend.mockReset().mockResolvedValue({
    Credentials: { AccessKeyId: 'AK', SecretAccessKey: 'SK', SessionToken: 'ST' },
  });
  schedulerSend.mockReset().mockResolvedValue({});
  fetchMock.mockReset().mockResolvedValue({
    status: 200,
    headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
    text: () => Promise.resolve(upstreamBody),
  });
  setGatewayFetch(fetchMock);
  resetGatewayKeyCache();
});

afterEach(() => {
  setEcsClient(undefined);
  setStsClient(undefined);
  resetSchedulerClient();
  setGatewayFetch(undefined);
  for (const key of Object.keys(SANDBOX_ENV)) delete process.env[key];
});

interface Launched {
  runId: RunId;
  /** The full gateway bearer token exactly as injected into the task env. */
  token: string;
  appEnv: Record<string, string | undefined>;
}

/** Launch through the real path and pull the injected env off the RunTask call. */
async function launch(): Promise<Launched> {
  const result = await executeSandboxRun(ctx, agent);
  expect(result.status).toBe('running');
  const runTask = ecsSend.mock.calls
    .map((call) => call[0] as unknown)
    .find((cmd): cmd is RunTaskCommand => cmd instanceof RunTaskCommand);
  expect(runTask).toBeDefined();
  const app = runTask?.input.overrides?.containerOverrides?.find((o) => o.name === 'app');
  const appEnv = Object.fromEntries((app?.environment ?? []).map((e) => [e.name, e.value]));
  const token = appEnv['ANTHROPIC_API_KEY'];
  if (typeof token !== 'string') throw new Error('launcher did not inject a gateway token');
  return { runId: result.runId, token, appEnv };
}

const gatewayRequest = (token: string): GatewayRequest => ({
  method: 'POST',
  path: '/v1/messages',
  token,
  body: gatewayBody,
  headers: { 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
});

const capturedCreateSchedule = (): CreateScheduleCommand => {
  const cmd = schedulerSend.mock.calls
    .map((call) => call[0] as unknown)
    .find((c): c is CreateScheduleCommand => c instanceof CreateScheduleCommand);
  expect(cmd).toBeDefined();
  return cmd as CreateScheduleCommand;
};

const storedRun = (runId: RunId): Run => {
  const run = state.runs.get(runId);
  expect(run).toBeDefined();
  return run as Run;
};

// ---------------------------------------------------------------------------
// Scenario 1 — forced spend breach stops LLM access mid-run; actual cost wins.
// ---------------------------------------------------------------------------

describe('acceptance: forced spend breach mid-run', () => {
  it('gateway 402s once the limit is exhausted; the run finalizes as spend_limit_exceeded at actual cost', async () => {
    // Budget: the flat compute reservation plus exactly one worst-case LLM call.
    state.ledger.spendLimitUsd = FLAT_ESTIMATE + CALL_ESTIMATE;

    const { runId, token } = await launch();

    // First call: the token the launcher injected authenticates against the
    // hash it persisted; reserve → forward → reconcile-to-usage succeeds.
    const first = await handleGatewayRequest(gatewayRequest(token));
    expect(first.status).toBe(200);
    expect(state.ledger.spendUsedUsd).toBeCloseTo(FLAT_ESTIMATE + CALL_ACTUAL, 12);
    expect(storedRun(runId).costUsd).toBeCloseTo(FLAT_ESTIMATE + CALL_ACTUAL, 12);

    // Second call: the reservation no longer fits — 402, never forwarded.
    const second = await handleGatewayRequest(gatewayRequest(token));
    expect(second.status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(storedRun(runId).status).toBe('spend_limit_exceeded');

    // The breach is sticky: retries keep 402-ing while the task is still up.
    expect((await handleGatewayRequest(gatewayRequest(token))).status).toBe(402);
    expect(state.ledger.spendUsedUsd).toBeCloseTo(FLAT_ESTIMATE + CALL_ACTUAL, 12);

    // The app exits (non-zero) and the ECS stop event finalizes the run.
    const durationMs = 120_000; // 2 of the reserved 10 minutes actually used
    await finalizeSandboxRun({
      agentId: AGENT_ID,
      runId,
      exitCode: 1,
      stoppedReason: 'Essential container in task exited',
      durationMs,
      taskStartedAt: '2026-07-03T12:00:20.000Z',
      taskStoppedAt: '2026-07-03T12:02:20.000Z',
    });

    const run = storedRun(runId);
    // The mid-run breach outcome survives the exit-code mapping.
    expect(run.status).toBe('spend_limit_exceeded');
    // Actual (reconciled) cost — actual compute + actual LLM usage — never the
    // flat launch-time estimate.
    const actualTotal = actualSandboxCost(durationMs, TASK_CPU, TASK_MEM_MB) + CALL_ACTUAL;
    expect(run.costUsd).toBeCloseTo(actualTotal, 12);
    expect(run.costUsd).toBeLessThan(FLAT_ESTIMATE);
    expect(run.reservedUsd).toBeNull();
    // The run record's cost equals exactly what the agent ledger was charged.
    expect(state.ledger.spendUsedUsd).toBeCloseTo(run.costUsd, 12);
    // Slot released, kill switch disarmed, real events persisted.
    expect(state.ledger.activeRunId).toBeNull();
    const deleted = schedulerSend.mock.calls
      .map((call) => call[0] as unknown)
      .find((c): c is DeleteScheduleCommand => c instanceof DeleteScheduleCommand);
    expect(deleted?.input.Name).toBe(watchdogScheduleName(runId));
    expect(run.events.map((e) => e.event)).toEqual([
      'sandbox.run.launched',
      'sandbox.run.task_started',
      'sandbox.run.task_stopped',
      'sandbox.run.finalized',
    ]);

    // A redelivered stop event (EventBridge is at-least-once) changes nothing:
    // no double refund on the ledger, no cost shift, no duplicate events.
    await finalizeSandboxRun({
      agentId: AGENT_ID,
      runId,
      exitCode: 1,
      stoppedReason: 'Essential container in task exited',
      durationMs,
      taskStartedAt: '2026-07-03T12:00:20.000Z',
      taskStoppedAt: '2026-07-03T12:02:20.000Z',
    });
    const redelivered = storedRun(runId);
    expect(redelivered.costUsd).toBeCloseTo(actualTotal, 12);
    expect(state.ledger.spendUsedUsd).toBeCloseTo(actualTotal, 12);
    expect(redelivered.events).toHaveLength(4);

    // Regression (F1): a breached run is terminal, so its leaked token must
    // stop authenticating — even though spend_limit_exceeded is also the
    // still-alive breach status the gateway honors mid-run. Finalize nulled
    // gatewayTokenHash, so a post-run replay is rejected outright (401), and
    // the compute refund that dropped spendUsedUsd back under the limit can
    // never be spent by the dead run's token.
    expect(state.ledger.spendUsedUsd).toBeLessThan(state.ledger.spendLimitUsd);
    expect((await handleGatewayRequest(gatewayRequest(token))).status).toBe(401);
  });

  it('rejects the launch outright when the flat reservation itself no longer fits', async () => {
    state.ledger.spendLimitUsd = FLAT_ESTIMATE / 2;
    const result = await executeSandboxRun(ctx, agent);
    expect(result.status).toBe('spend_limit_exceeded');
    expect(ecsSend).not.toHaveBeenCalled();
    expect(state.ledger.spendUsedUsd).toBe(0);
    expect(storedRun(result.runId).status).toBe('spend_limit_exceeded');
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — forced hang is killed at timeout; kill switch arm/disarm.
// ---------------------------------------------------------------------------

describe('acceptance: forced hang killed at timeout', () => {
  it('arms a one-shot StopTask watchdog at timeoutMinutes + grace and injects AV_TIMEOUT_SECONDS', async () => {
    const before = Date.now();
    const { runId, appEnv } = await launch();
    // In-container fallback: entrypoint.sh wraps the app in `timeout` with this.
    expect(appEnv['AV_TIMEOUT_SECONDS']).toBe(String(TIMEOUT_MINUTES * 60));
    // Platform-side backstop: the schedule that fires ecs:StopTask.
    const create = capturedCreateSchedule();
    expect(create.input.Name).toBe(watchdogScheduleName(runId));
    expect(create.input.GroupName).toBe(SANDBOX_ENV.AV_WATCHDOG_GROUP);
    const at = /^at\((.+)\)$/.exec(create.input.ScheduleExpression ?? '');
    expect(at).not.toBeNull();
    const fireAt = new Date(`${at?.[1]}Z`).getTime();
    const expected = before + (TIMEOUT_MINUTES + WATCHDOG_GRACE_MINUTES) * 60_000;
    expect(Math.abs(fireAt - expected)).toBeLessThan(5_000);
    const target = JSON.parse(create.input.Target?.Input ?? '{}') as Record<string, string>;
    expect(target['cluster']).toBe(SANDBOX_ENV.AV_SANDBOX_CLUSTER_ARN);
    expect(target['task']).toBe(TASK_ARN);
  });

  it('a watchdog-stopped task finalizes as timed_out at actual cost and its gateway token dies', async () => {
    const { runId, token } = await launch();
    // The watchdog's own StopTask reason is what ECS reports back — feed the
    // exact string from the armed schedule into the lifecycle path (lockstep).
    const create = capturedCreateSchedule();
    const target = JSON.parse(create.input.Target?.Input ?? '{}') as Record<string, string>;
    const stoppedReason = target['reason'] ?? '';
    expect(stoppedReason).toContain('timed out');
    // The fired schedule self-deleted (ActionAfterCompletion=DELETE), so the
    // lifecycle's disarm hits ResourceNotFoundException — the expected race.
    schedulerSend.mockImplementation((cmd: unknown) =>
      cmd instanceof DeleteScheduleCommand
        ? Promise.reject(Object.assign(new Error('gone'), { name: 'ResourceNotFoundException' }))
        : Promise.resolve({}),
    );

    const durationMs = (TIMEOUT_MINUTES + WATCHDOG_GRACE_MINUTES) * 60_000;
    await finalizeSandboxRun({
      agentId: AGENT_ID,
      runId,
      exitCode: null,
      stoppedReason,
      durationMs,
      taskStartedAt: '2026-07-03T12:00:20.000Z',
      taskStoppedAt: '2026-07-03T12:12:20.000Z',
    });

    const run = storedRun(runId);
    expect(run.status).toBe('timed_out');
    expect(run.error).toBe(stoppedReason);
    // The run outlived its priced window, so actual > flat — still reconciled.
    const actualUsd = actualSandboxCost(durationMs, TASK_CPU, TASK_MEM_MB);
    expect(actualUsd).toBeGreaterThan(FLAT_ESTIMATE);
    expect(run.costUsd).toBeCloseTo(actualUsd, 12);
    expect(run.reservedUsd).toBeNull();
    expect(state.ledger.spendUsedUsd).toBeCloseTo(actualUsd, 12);
    expect(state.ledger.activeRunId).toBeNull();

    // A killed run's gateway token is no longer honored: finalize nulled its
    // hash, so authentication fails at the hash check (401) before the
    // run-status check is even reached.
    expect((await handleGatewayRequest(gatewayRequest(token))).status).toBe(401);
  });

  it('the in-container timeout fallback (exit 124) also finalizes as timed_out', async () => {
    const { runId } = await launch();
    await finalizeSandboxRun({
      agentId: AGENT_ID,
      runId,
      exitCode: 124,
      stoppedReason: 'Essential container in task exited',
      durationMs: TIMEOUT_MINUTES * 60_000,
    });
    expect(storedRun(runId).status).toBe('timed_out');
    expect(state.ledger.activeRunId).toBeNull();
  });
});
