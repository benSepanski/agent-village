import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunTaskCommand } from '@aws-sdk/client-ecs';
import { AssumeRoleCommand } from '@aws-sdk/client-sts';
import type { Agent, ApplicationManifest } from '@agent-village/shared';

const { grantSecretsMock } = vi.hoisted(() => ({
  grantSecretsMock: { getNotionToken: vi.fn(), getGithubPat: vi.fn() },
}));

vi.mock('@agent-village/data', () => ({ grantSecrets: grantSecretsMock }));

import { launchSandboxRun, setEcsClient, setStsClient } from './sandbox.js';

const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const RUN_ID = '01HZN0PQRSTVWXYZ0123456789';
const SUB = 'cog-sub-abc';
const NOTION_SECRET = `agent-village/dev/agents/${AGENT_ID}/notion-token`;
const GITHUB_SECRET = `agent-village/dev/agents/${AGENT_ID}/github-pat`;

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
  AV_REGION: 'us-east-1',
  AV_ENV: 'dev',
};

beforeEach(() => {
  Object.assign(process.env, SANDBOX_ENV);
  setEcsClient({ send: ecsSend } as never);
  setStsClient({ send: stsSend } as never);
  ecsSend.mockReset();
  stsSend.mockReset();
  grantSecretsMock.getNotionToken.mockReset();
  grantSecretsMock.getGithubPat.mockReset();
  grantSecretsMock.getNotionToken.mockResolvedValue('ntn-token');
  grantSecretsMock.getGithubPat.mockResolvedValue('ghp-token');
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

  it('adds an egress-proxy override with the AWS-base ∪ manifest allowlist', async () => {
    await launchSandboxRun({
      agent,
      manifest: { ...manifest, egressAllow: ['api.notion.com', '*.githubusercontent.com'] },
      runId: RUN_ID,
    });
    const cmd = ecsSend.mock.calls[0]![0] as RunTaskCommand;
    const overrides = cmd.input.overrides?.containerOverrides ?? [];
    const proxy = overrides.find((o) => o.name === 'egress-proxy');
    expect(proxy).toBeDefined();
    const allow = proxy?.environment?.find((e) => e.name === 'AV_EGRESS_ALLOW')?.value ?? '';
    const domains = allow.split(',');
    // Base AWS domains keep `aws s3 sync` working.
    expect(domains).toContain('s3.us-east-1.amazonaws.com');
    expect(domains).toContain('sts.us-east-1.amazonaws.com');
    // Union with the manifest's own allowlist.
    expect(domains).toContain('api.notion.com');
    expect(domains).toContain('*.githubusercontent.com');
  });

  it('does NOT set HTTP(S)_PROXY on the app container (transparent proxy has no CONNECT; would break aws s3 sync)', async () => {
    await launchSandboxRun({ agent, manifest, runId: RUN_ID });
    const cmd = ecsSend.mock.calls[0]![0] as RunTaskCommand;
    const app = cmd.input.overrides?.containerOverrides?.find((o) => o.name === 'app');
    const env = Object.fromEntries((app?.environment ?? []).map((e) => [e.name, e.value]));
    expect(env['HTTP_PROXY']).toBeUndefined();
    expect(env['HTTPS_PROXY']).toBeUndefined();
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

  it('fetches and injects Notion + GitHub tokens as app-container env', async () => {
    await launchSandboxRun({
      agent,
      manifest: {
        ...manifest,
        grants: [
          { kind: 'notion', secretName: NOTION_SECRET },
          { kind: 'github', repos: ['acme/app'], secretName: GITHUB_SECRET },
        ],
      },
      runId: RUN_ID,
    });
    expect(grantSecretsMock.getNotionToken).toHaveBeenCalledWith(NOTION_SECRET);
    expect(grantSecretsMock.getGithubPat).toHaveBeenCalledWith(GITHUB_SECRET);
    const cmd = ecsSend.mock.calls[0]![0] as RunTaskCommand;
    const app = cmd.input.overrides?.containerOverrides?.find((o) => o.name === 'app');
    const env = Object.fromEntries((app?.environment ?? []).map((e) => [e.name, e.value]));
    expect(env['NOTION_TOKEN']).toBe('ntn-token');
    expect(env['GITHUB_TOKEN']).toBe('ghp-token');
    expect(env['GITHUB_REPOS']).toBe('acme/app');
    // STS env untouched.
    expect(env['AWS_SESSION_TOKEN']).toBe('ST');
  });

  it('narrows the STS session policy with SES From/Recipients conditions for an SesGrant', async () => {
    await launchSandboxRun({
      agent,
      manifest: {
        ...manifest,
        grants: [
          {
            kind: 'ses',
            fromAddress: 'bot@example.com',
            allowedRecipients: ['a@example.com', 'b@example.com'],
          },
        ],
      },
      runId: RUN_ID,
    });
    const cmd = stsSend.mock.calls[0]![0] as AssumeRoleCommand;
    const policy = JSON.parse(cmd.input.Policy ?? '{}') as {
      Statement: Array<{
        Action?: string | string[];
        Condition?: Record<string, Record<string, string | string[]>>;
      }>;
    };
    const ses = policy.Statement.find((s) => JSON.stringify(s.Action).includes('ses:SendEmail'));
    expect(ses).toBeDefined();
    expect(ses?.Condition?.['StringEquals']?.['ses:FromAddress']).toBe('bot@example.com');
    expect(ses?.Condition?.['ForAllValues:StringLike']?.['ses:Recipients']).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
    const runCmd = ecsSend.mock.calls[0]![0] as RunTaskCommand;
    const app = runCmd.input.overrides?.containerOverrides?.find((o) => o.name === 'app');
    const env = Object.fromEntries((app?.environment ?? []).map((e) => [e.name, e.value]));
    expect(env['AV_SES_FROM']).toBe('bot@example.com');
    expect(env['AV_SES_RECIPIENTS']).toBe('a@example.com,b@example.com');
  });

  it('rejects a grant secretName owned by another agent', async () => {
    await expect(
      launchSandboxRun({
        agent,
        manifest: {
          ...manifest,
          grants: [
            { kind: 'notion', secretName: 'agent-village/dev/agents/other-agent/notion-token' },
          ],
        },
        runId: RUN_ID,
      }),
    ).rejects.toThrow(/not under agent/);
    expect(ecsSend).not.toHaveBeenCalled();
  });
});
