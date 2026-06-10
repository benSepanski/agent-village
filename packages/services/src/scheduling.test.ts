import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
  type SchedulerClient,
  UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import {
  removeSchedule,
  resetSchedulerClient,
  setSchedulerClient,
  toEventBridgeExpression,
  upsertSchedule,
} from './scheduling.js';

const RUNNER_ARN = 'arn:aws:lambda:us-east-1:0:function:runner';
const ROLE_ARN = 'arn:aws:iam::0:role/scheduler';
const GROUP = 'av-test';
const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';

const sendMock = vi.fn();
const fakeClient = { send: sendMock } as unknown as SchedulerClient;

beforeEach(() => {
  process.env['AV_SCHEDULER_GROUP'] = GROUP;
  process.env['AV_RUNNER_LAMBDA_ARN'] = RUNNER_ARN;
  process.env['AV_SCHEDULER_ROLE_ARN'] = ROLE_ARN;
  sendMock.mockReset();
  setSchedulerClient(fakeClient);
});

afterEach(() => {
  delete process.env['AV_SCHEDULER_GROUP'];
  delete process.env['AV_RUNNER_LAMBDA_ARN'];
  delete process.env['AV_SCHEDULER_ROLE_ARN'];
  resetSchedulerClient();
});

describe('toEventBridgeExpression', () => {
  it('passes through cron(...) syntax', () => {
    expect(toEventBridgeExpression('cron(0 12 * * ? *)')).toBe('cron(0 12 * * ? *)');
  });

  it('passes through rate(...) syntax', () => {
    expect(toEventBridgeExpression('rate(5 minutes)')).toBe('rate(5 minutes)');
  });

  it('translates 5-field cron with both DOM and DOW as wildcards', () => {
    expect(toEventBridgeExpression('*/5 * * * *')).toBe('cron(*/5 * * * ? *)');
  });

  it('uses ? for DOW when DOM is specific', () => {
    expect(toEventBridgeExpression('0 12 1 * *')).toBe('cron(0 12 1 * ? *)');
  });

  it('uses ? for DOM when DOW is specific', () => {
    expect(toEventBridgeExpression('0 12 * * MON')).toBe('cron(0 12 ? * MON *)');
  });

  it('remaps numeric Unix DOW (Sun=0) to EventBridge DOW (Sun=1)', () => {
    // Unix Monday=1 → EventBridge Monday=2
    expect(toEventBridgeExpression('0 9 * * 1')).toBe('cron(0 9 ? * 2 *)');
    // Unix Sunday=0 → EventBridge Sunday=1
    expect(toEventBridgeExpression('0 9 * * 0')).toBe('cron(0 9 ? * 1 *)');
    // Unix Sunday=7 → EventBridge Sunday=1
    expect(toEventBridgeExpression('0 9 * * 7')).toBe('cron(0 9 ? * 1 *)');
  });

  it('remaps numeric DOW inside ranges and lists', () => {
    // Unix Mon-Fri (1-5) → EventBridge 2-6
    expect(toEventBridgeExpression('0 9 * * 1-5')).toBe('cron(0 9 ? * 2-6 *)');
    // Unix Sun,Sat (0,6) → EventBridge 1,7
    expect(toEventBridgeExpression('0 9 * * 0,6')).toBe('cron(0 9 ? * 1,7 *)');
  });

  it('leaves day-of-week names untouched', () => {
    expect(toEventBridgeExpression('0 9 * * MON-FRI')).toBe('cron(0 9 ? * MON-FRI *)');
  });

  it('rejects expressions with the wrong field count', () => {
    expect(() => toEventBridgeExpression('* * * *')).toThrow();
  });
});

describe('upsertSchedule', () => {
  it('issues CreateSchedule with the lambda target', async () => {
    sendMock.mockResolvedValue({});
    await upsertSchedule(AGENT_ID, '*/5 * * * *');
    const cmd = sendMock.mock.calls[0]![0];
    expect(cmd).toBeInstanceOf(CreateScheduleCommand);
    expect(cmd.input.Name).toBe(`agent-${AGENT_ID}`);
    expect(cmd.input.GroupName).toBe(GROUP);
    expect(cmd.input.Target?.Arn).toBe(RUNNER_ARN);
    expect(cmd.input.ScheduleExpression).toBe('cron(*/5 * * * ? *)');
  });

  it('falls back to UpdateSchedule when the schedule already exists', async () => {
    sendMock
      .mockRejectedValueOnce(Object.assign(new Error('conflict'), { name: 'ConflictException' }))
      .mockResolvedValueOnce({});
    await upsertSchedule(AGENT_ID, '*/5 * * * *');
    expect(sendMock.mock.calls[1]![0]).toBeInstanceOf(UpdateScheduleCommand);
  });
});

describe('removeSchedule', () => {
  it('deletes the schedule', async () => {
    sendMock.mockResolvedValue({});
    await removeSchedule(AGENT_ID);
    expect(sendMock.mock.calls[0]![0]).toBeInstanceOf(DeleteScheduleCommand);
  });

  it('swallows ResourceNotFoundException (idempotent)', async () => {
    sendMock.mockRejectedValue(
      Object.assign(new Error('gone'), { name: 'ResourceNotFoundException' }),
    );
    await expect(removeSchedule(AGENT_ID)).resolves.toBeUndefined();
  });
});
