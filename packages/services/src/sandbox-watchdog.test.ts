import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StopTaskCommand } from '@aws-sdk/client-ecs';
import type { ECSClient } from '@aws-sdk/client-ecs';
import { CreateScheduleCommand, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import type { RunId } from '@agent-village/shared';
import { armRunWatchdog, deleteRunWatchdog, watchdogScheduleName } from './sandbox-watchdog.js';
import { resetSchedulerClient, setSchedulerClient } from './scheduling.js';

const RUN_ID = '01HZN0PQRSTVWXYZ0123456789' as RunId;
const TASK_ARN = 'arn:aws:ecs:us-east-1:0:task/agent-village-dev-sandbox/abc';
const CLUSTER_ARN = 'arn:aws:ecs:us-east-1:0:cluster/agent-village-dev-sandbox';

const WATCHDOG_ENV = {
  AV_WATCHDOG_GROUP: 'agent-village-dev-run-watchdogs',
  AV_WATCHDOG_ROLE_ARN: 'arn:aws:iam::0:role/agent-village-dev-run-watchdog',
  AV_WATCHDOG_DLQ_ARN: 'arn:aws:sqs:us-east-1:0:agent-village-dev-run-watchdog-dlq',
};

const schedulerSend = vi.fn();
const ecsSend = vi.fn();
const ecs = { send: ecsSend } as unknown as ECSClient;

const armInput = { runId: RUN_ID, taskArn: TASK_ARN, clusterArn: CLUSTER_ARN, timeoutMinutes: 30 };

beforeEach(() => {
  Object.assign(process.env, WATCHDOG_ENV);
  schedulerSend.mockReset().mockResolvedValue({});
  ecsSend.mockReset().mockResolvedValue({});
  setSchedulerClient({ send: schedulerSend } as never);
});

afterEach(() => {
  resetSchedulerClient();
  for (const key of Object.keys(WATCHDOG_ENV)) delete process.env[key];
  vi.useRealTimers();
});

describe('armRunWatchdog', () => {
  it('creates a self-deleting one-shot StopTask schedule at timeout + grace', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-03T10:00:00.000Z') });
    await armRunWatchdog(ecs, armInput);
    const cmd = schedulerSend.mock.calls[0]![0] as CreateScheduleCommand;
    expect(cmd).toBeInstanceOf(CreateScheduleCommand);
    expect(cmd.input.Name).toBe(`run-watchdog-${RUN_ID}`);
    expect(cmd.input.GroupName).toBe(WATCHDOG_ENV.AV_WATCHDOG_GROUP);
    // 30 min timeout + 5 min grace (grace absorbs Fargate startup + final sync).
    expect(cmd.input.ScheduleExpression).toBe('at(2026-07-03T10:35:00)');
    expect(cmd.input.ActionAfterCompletion).toBe('DELETE');
    expect(cmd.input.Target?.Arn).toBe('arn:aws:scheduler:::aws-sdk:ecs:stopTask');
    expect(cmd.input.Target?.RoleArn).toBe(WATCHDOG_ENV.AV_WATCHDOG_ROLE_ARN);
    // StopTask is retryable (success on an already-stopped task), so a transient
    // throttle at fire time is retried, then dead-lettered — never silently lost.
    expect(cmd.input.Target?.RetryPolicy?.MaximumRetryAttempts).toBeGreaterThan(0);
    expect(cmd.input.Target?.DeadLetterConfig?.Arn).toBe(WATCHDOG_ENV.AV_WATCHDOG_DLQ_ARN);
    const input = JSON.parse(cmd.input.Target?.Input ?? '{}') as Record<string, string>;
    expect(input['cluster']).toBe(CLUSTER_ARN);
    expect(input['task']).toBe(TASK_ARN);
    // The reason is the lifecycle handler's timeout marker.
    expect(input['reason']).toContain('timed out');
  });

  it('throws when the dead-letter queue is not configured', async () => {
    delete process.env['AV_WATCHDOG_DLQ_ARN'];
    await expect(armRunWatchdog(ecs, armInput)).rejects.toThrow('AV_WATCHDOG_DLQ_ARN');
  });

  it('stops the task and rethrows when the schedule cannot be created', async () => {
    schedulerSend.mockRejectedValue(new Error('scheduler down'));
    await expect(armRunWatchdog(ecs, armInput)).rejects.toThrow('scheduler down');
    const stop = ecsSend.mock.calls[0]![0] as StopTaskCommand;
    expect(stop).toBeInstanceOf(StopTaskCommand);
    expect(stop.input.cluster).toBe(CLUSTER_ARN);
    expect(stop.input.task).toBe(TASK_ARN);
  });

  it('still rethrows the arm failure when the best-effort StopTask also fails', async () => {
    schedulerSend.mockRejectedValue(new Error('scheduler down'));
    ecsSend.mockRejectedValue(new Error('task gone'));
    await expect(armRunWatchdog(ecs, armInput)).rejects.toThrow('scheduler down');
  });
});

describe('deleteRunWatchdog', () => {
  it('deletes the schedule named after the run id', async () => {
    await deleteRunWatchdog(RUN_ID);
    const cmd = schedulerSend.mock.calls[0]![0] as DeleteScheduleCommand;
    expect(cmd).toBeInstanceOf(DeleteScheduleCommand);
    expect(cmd.input.Name).toBe(watchdogScheduleName(RUN_ID));
    expect(cmd.input.GroupName).toBe(WATCHDOG_ENV.AV_WATCHDOG_GROUP);
  });

  it('is a no-op when the schedule already fired and self-deleted', async () => {
    const notFound = new Error('gone');
    notFound.name = 'ResourceNotFoundException';
    schedulerSend.mockRejectedValue(notFound);
    await expect(deleteRunWatchdog(RUN_ID)).resolves.toBeUndefined();
  });

  it('swallows unexpected delete failures (cleanup is best effort)', async () => {
    schedulerSend.mockRejectedValue(new Error('throttled'));
    await expect(deleteRunWatchdog(RUN_ID)).resolves.toBeUndefined();
  });
});
