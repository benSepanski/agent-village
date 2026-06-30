import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunTaskCommand } from '@aws-sdk/client-ecs';
import { AssumeRoleCommand } from '@aws-sdk/client-sts';
import type { Agent, ApplicationManifest } from '@agent-village/shared';
import { launchSandboxRun, setEcsClient, setStsClient } from './sandbox.js';

const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const RUN_ID = '01HZN0PQRSTVWXYZ0123456789';
const SUB = 'cog-sub-abc';

const agent = { id: AGENT_ID, ownerSub: SUB } as unknown as Agent;

const manifest: ApplicationManifest = {
  name: 'reporter',
  image: 'acct.dkr.ecr.us-east-1.amazonaws.com/app:latest',
  command: ['python', '/workspace/app.py'],
  schedule: null,
  timeoutMinutes: 30,
  egressAllow: [],
  grants: [],
  flushIntervalSeconds: 120,
};

const ecsSend = vi.fn();
const stsSend = vi.fn();

const SANDBOX_ENV = {
  AV_SANDBOX_CLUSTER_ARN: 'arn:aws:ecs:us-east-1:0:cluster/agent-village-dev-sandbox',
  AV_SANDBOX_TASKDEF_ARN: 'arn:aws:ecs:us-east-1:0:task-definition/agent-village-dev-sandbox:1',
  AV_SANDBOX_TASK_ROLE_ARN: 'arn:aws:iam::0:role/task',
  AV_SANDBOX_SUBNET_IDS: 'subnet-a,subnet-b',
  AV_SANDBOX_SECURITY_GROUP: 'sg-123',
  AV_WORKSPACE_BUCKET: 'workspace-bucket',
};

beforeEach(() => {
  Object.assign(process.env, SANDBOX_ENV);
  setEcsClient({ send: ecsSend } as never);
  setStsClient({ send: stsSend } as never);
  ecsSend.mockReset();
  stsSend.mockReset();
  stsSend.mockResolvedValue({
    Credentials: { AccessKeyId: 'AK', SecretAccessKey: 'SK', SessionToken: 'ST' },
  });
  ecsSend.mockResolvedValue({ tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:0:task/abc' }] });
});

afterEach(() => {
  setEcsClient(undefined);
  setStsClient(undefined);
  for (const key of Object.keys(SANDBOX_ENV)) delete process.env[key];
});

describe('launchSandboxRun', () => {
  it('assumes the task role with a prefix-scoped, duration-clamped session policy', async () => {
    await launchSandboxRun({ agent, manifest, runId: RUN_ID });
    const cmd = stsSend.mock.calls[0]![0] as AssumeRoleCommand;
    expect(cmd).toBeInstanceOf(AssumeRoleCommand);
    expect(cmd.input.RoleArn).toBe(SANDBOX_ENV.AV_SANDBOX_TASK_ROLE_ARN);
    expect(cmd.input.RoleSessionName).toBe(`sandbox-${RUN_ID}`);
    // 30 min * 60 + 300s buffer = 2100s, under the 7200s ceiling.
    expect(cmd.input.DurationSeconds).toBe(2100);
    expect(cmd.input.Policy).toContain(`workspace-bucket/${SUB}/${AGENT_ID}/`);
  });

  it('runs the task with startedBy=runId, group carrying the agent id, and workspace env', async () => {
    const taskArn = await launchSandboxRun({ agent, manifest, runId: RUN_ID });
    expect(taskArn).toBe('arn:aws:ecs:us-east-1:0:task/abc');
    const cmd = ecsSend.mock.calls[0]![0] as RunTaskCommand;
    expect(cmd).toBeInstanceOf(RunTaskCommand);
    expect(cmd.input.startedBy).toBe(RUN_ID);
    expect(cmd.input.group).toBe(`av:${AGENT_ID}`);
    expect(cmd.input.launchType).toBe('FARGATE');
    expect(cmd.input.networkConfiguration?.awsvpcConfiguration?.subnets).toEqual([
      'subnet-a',
      'subnet-b',
    ]);
    const override = cmd.input.overrides?.containerOverrides?.[0];
    expect(override?.name).toBe('app');
    expect(override?.command).toEqual(['python', '/workspace/app.py']);
    const env = Object.fromEntries((override?.environment ?? []).map((e) => [e.name, e.value]));
    expect(env['AV_WORKSPACE_URI']).toBe(`s3://workspace-bucket/${SUB}/${AGENT_ID}/`);
    expect(env['AV_FLUSH_SECONDS']).toBe('120');
    expect(env['AWS_SESSION_TOKEN']).toBe('ST');
  });

  it('clamps the session duration to the 7200s ceiling for long timeouts', async () => {
    await launchSandboxRun({
      agent,
      manifest: { ...manifest, timeoutMinutes: 120 },
      runId: RUN_ID,
    });
    expect((stsSend.mock.calls[0]![0] as AssumeRoleCommand).input.DurationSeconds).toBe(7200);
  });

  it('throws when AssumeRole returns incomplete credentials', async () => {
    stsSend.mockResolvedValue({ Credentials: { AccessKeyId: 'AK' } });
    await expect(launchSandboxRun({ agent, manifest, runId: RUN_ID })).rejects.toThrow(
      /incomplete credentials/,
    );
    expect(ecsSend).not.toHaveBeenCalled();
  });
});
