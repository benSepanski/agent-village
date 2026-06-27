import {
  type ContainerOverride,
  ECSClient,
  type KeyValuePair,
  RunTaskCommand,
} from '@aws-sdk/client-ecs';
import { AssumeRoleCommand, type Credentials, STSClient } from '@aws-sdk/client-sts';
import {
  workspacePrefix,
  type Agent,
  type ApplicationManifest,
  type RunId,
} from '@agent-village/shared';
import { logger } from './logger.js';

export interface SandboxConfig {
  clusterArn: string;
  taskDefinitionArn: string;
  taskRoleArn: string;
  subnetIds: string[];
  securityGroupId: string;
  workspaceBucket: string;
}

export interface LaunchInput {
  agent: Agent;
  manifest: ApplicationManifest;
  runId: RunId;
}

const SESSION_BUFFER_SECONDS = 300;
const MAX_SESSION_SECONDS = 7200;
const SECONDS_PER_MINUTE = 60;
/** Prefix on the ECS task `group` carrying the agent id back to the lifecycle handler. */
export const AGENT_GROUP_PREFIX = 'av:';

let ecsClient: ECSClient | undefined;
let stsClient: STSClient | undefined;

function clientRegion(): string {
  return process.env['AWS_REGION'] ?? 'us-east-1';
}

export function getEcsClient(): ECSClient {
  ecsClient ??= new ECSClient({ region: clientRegion() });
  return ecsClient;
}

export function getStsClient(): STSClient {
  stsClient ??= new STSClient({ region: clientRegion() });
  return stsClient;
}

/** Test-only: inject (or clear with `undefined`) the ECS client. */
export function setEcsClient(client: ECSClient | undefined): void {
  ecsClient = client;
}

/** Test-only: inject (or clear with `undefined`) the STS client. */
export function setStsClient(client: STSClient | undefined): void {
  stsClient = client;
}

export function getSandboxConfig(): SandboxConfig {
  const clusterArn = process.env['AV_SANDBOX_CLUSTER_ARN'];
  const taskDefinitionArn = process.env['AV_SANDBOX_TASKDEF_ARN'];
  const taskRoleArn = process.env['AV_SANDBOX_TASK_ROLE_ARN'];
  const subnets = process.env['AV_SANDBOX_SUBNET_IDS'];
  const securityGroupId = process.env['AV_SANDBOX_SECURITY_GROUP'];
  const workspaceBucket = process.env['AV_WORKSPACE_BUCKET'];
  if (
    !clusterArn ||
    !taskDefinitionArn ||
    !taskRoleArn ||
    !subnets ||
    !securityGroupId ||
    !workspaceBucket
  ) {
    throw new Error('sandbox launcher env vars are required (AV_SANDBOX_* / AV_WORKSPACE_BUCKET)');
  }
  return {
    clusterArn,
    taskDefinitionArn,
    taskRoleArn,
    subnetIds: subnets.split(',').filter(Boolean),
    securityGroupId,
    workspaceBucket,
  };
}

/**
 * Inline session policy that narrows the bucket-wide task role to exactly this
 * agent's workspace prefix — the per-run scoping from ADR 0002. `s3:ListBucket`
 * is conditioned on the prefix so `aws s3 sync` can enumerate.
 */
function buildSessionPolicy(bucket: string, prefix: string): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'WorkspaceObjects',
        Effect: 'Allow',
        Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        Resource: `arn:aws:s3:::${bucket}/${prefix}*`,
      },
      {
        Sid: 'WorkspaceList',
        Effect: 'Allow',
        Action: 's3:ListBucket',
        Resource: `arn:aws:s3:::${bucket}`,
        Condition: { StringLike: { 's3:prefix': `${prefix}*` } },
      },
    ],
  });
}

async function assumeScopedCreds(input: LaunchInput, config: SandboxConfig): Promise<Credentials> {
  const prefix = workspacePrefix(input.agent.ownerSub, input.agent.id);
  const durationSeconds = Math.min(
    input.manifest.timeoutMinutes * SECONDS_PER_MINUTE + SESSION_BUFFER_SECONDS,
    MAX_SESSION_SECONDS,
  );
  const res = await getStsClient().send(
    new AssumeRoleCommand({
      RoleArn: config.taskRoleArn,
      RoleSessionName: `sandbox-${input.runId}`,
      DurationSeconds: durationSeconds,
      Policy: buildSessionPolicy(config.workspaceBucket, prefix),
    }),
  );
  const creds = res.Credentials;
  if (!creds?.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken) {
    throw new Error('AssumeRole returned incomplete credentials');
  }
  return creds;
}

// The entrypoint reads AV_WORKSPACE_URI + AV_FLUSH_SECONDS; the scoped STS creds
// override the task role so `aws s3 sync` is confined to this agent's prefix.
function buildEnvironment(
  input: LaunchInput,
  config: SandboxConfig,
  creds: Credentials,
): KeyValuePair[] {
  const prefix = workspacePrefix(input.agent.ownerSub, input.agent.id);
  return [
    { name: 'AV_WORKSPACE_URI', value: `s3://${config.workspaceBucket}/${prefix}` },
    { name: 'AV_FLUSH_SECONDS', value: String(input.manifest.flushIntervalSeconds) },
    { name: 'AWS_ACCESS_KEY_ID', value: creds.AccessKeyId ?? '' },
    { name: 'AWS_SECRET_ACCESS_KEY', value: creds.SecretAccessKey ?? '' },
    { name: 'AWS_SESSION_TOKEN', value: creds.SessionToken ?? '' },
  ];
}

function buildContainerOverride(
  input: LaunchInput,
  config: SandboxConfig,
  creds: Credentials,
): ContainerOverride {
  const override: ContainerOverride = {
    name: 'app',
    environment: buildEnvironment(input, config, creds),
  };
  if (input.manifest.command) override.command = input.manifest.command;
  return override;
}

async function runTask(
  input: LaunchInput,
  config: SandboxConfig,
  creds: Credentials,
): Promise<string> {
  // runId travels in `startedBy` and agentId in `group`; both are first-class
  // fields echoed in the ECS Task State Change event the lifecycle handler reads.
  const res = await getEcsClient().send(
    new RunTaskCommand({
      cluster: config.clusterArn,
      taskDefinition: config.taskDefinitionArn,
      launchType: 'FARGATE',
      count: 1,
      startedBy: input.runId,
      group: `${AGENT_GROUP_PREFIX}${input.agent.id}`,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: config.subnetIds,
          securityGroups: [config.securityGroupId],
          assignPublicIp: 'ENABLED',
        },
      },
      overrides: { containerOverrides: [buildContainerOverride(input, config, creds)] },
    }),
  );
  const taskArn = res.tasks?.[0]?.taskArn;
  if (!taskArn) throw new Error('RunTask returned no task ARN');
  return taskArn;
}

/**
 * Launch a sandboxed application run on Fargate and return the task ARN. NOTE:
 * `manifest.image` is not yet honored — RunTask cannot override the container
 * image, so the static SandboxStack task definition (base image) runs the
 * manifest's command against the synced workspace. Registering a per-manifest
 * task definition is a documented follow-up.
 */
export async function launchSandboxRun(input: LaunchInput): Promise<string> {
  const config = getSandboxConfig();
  const creds = await assumeScopedCreds(input, config);
  const taskArn = await runTask(input, config, creds);
  logger.info({
    event: 'sandbox.run.launched',
    agentId: input.agent.id,
    runId: input.runId,
    taskArn,
  });
  return taskArn;
}
