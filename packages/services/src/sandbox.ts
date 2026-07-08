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
import { buildProxyOverride } from './sandbox-egress.js';
import { armRunWatchdog } from './sandbox-watchdog.js';
import {
  buildSesSessionStatements,
  resolveGrantEnv,
  type SessionStatement,
} from './sandbox-grants.js';

export interface SandboxConfig {
  clusterArn: string;
  taskDefinitionArn: string;
  taskRoleArn: string;
  subnetIds: string[];
  securityGroupId: string;
  workspaceBucket: string;
  /** Region used to expand the AWS base egress allowlist for the proxy. */
  region: string;
  /** Env name ('dev'|'prod') — scopes per-agent grant-secret ownership checks. */
  env: string;
  /** Anthropic metering gateway function URL (ADR 0004). */
  gatewayUrl: string;
}

export interface LaunchInput {
  agent: Agent;
  manifest: ApplicationManifest;
  runId: RunId;
  /** Per-run bearer token for the Anthropic metering gateway (ADR 0004). */
  gatewayToken: string;
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
  const region = process.env['AV_REGION'];
  const env = process.env['AV_ENV'];
  const gatewayUrl = process.env['AV_GATEWAY_URL'];
  if (
    !clusterArn ||
    !taskDefinitionArn ||
    !taskRoleArn ||
    !subnets ||
    !securityGroupId ||
    !workspaceBucket ||
    !region ||
    !env ||
    !gatewayUrl
  ) {
    throw new Error(
      'sandbox launcher env vars are required (AV_SANDBOX_* / AV_WORKSPACE_BUCKET / AV_REGION / AV_ENV / AV_GATEWAY_URL)',
    );
  }
  return {
    clusterArn,
    taskDefinitionArn,
    taskRoleArn,
    subnetIds: subnets.split(',').filter(Boolean),
    securityGroupId,
    workspaceBucket,
    region,
    env,
    gatewayUrl,
  };
}

/**
 * Inline session policy that narrows the bucket-wide task role to exactly this
 * agent's workspace prefix — the per-run scoping from ADR 0002. `s3:ListBucket`
 * is conditioned on the prefix so `aws s3 sync` can enumerate. SES grants (if
 * any) append send statements conditioned on their from-address + recipients,
 * further narrowing the task-role ceiling for that run.
 */
function buildSessionPolicy(
  bucket: string,
  prefix: string,
  sesStatements: SessionStatement[],
): string {
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
      ...sesStatements,
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
      Policy: buildSessionPolicy(
        config.workspaceBucket,
        prefix,
        buildSesSessionStatements(input.manifest),
      ),
    }),
  );
  const creds = res.Credentials;
  if (!creds?.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken) {
    throw new Error('AssumeRole returned incomplete credentials');
  }
  return creds;
}

interface AppOverrideInput {
  input: LaunchInput;
  config: SandboxConfig;
  creds: Credentials;
  /** Resolved per-run grant env (Notion/GitHub tokens, SES convenience env). */
  grantEnv: KeyValuePair[];
}

const trimTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

/** Gateway hostname — auto-unioned into the egress allowlist so LLM calls work. */
function gatewayHost(gatewayUrl: string): string {
  return new URL(gatewayUrl).hostname;
}

// The entrypoint reads AV_WORKSPACE_URI + AV_FLUSH_SECONDS; the scoped STS creds
// override the task role so `aws s3 sync` is confined to this agent's prefix.
function buildEnvironment(args: AppOverrideInput): KeyValuePair[] {
  const { input, config, creds, grantEnv } = args;
  const prefix = workspacePrefix(input.agent.ownerSub, input.agent.id);
  return [
    { name: 'AV_WORKSPACE_URI', value: `s3://${config.workspaceBucket}/${prefix}` },
    { name: 'AV_FLUSH_SECONDS', value: String(input.manifest.flushIntervalSeconds) },
    // In-container kill switch: the entrypoint wraps the app in `timeout -k`.
    {
      name: 'AV_TIMEOUT_SECONDS',
      value: String(input.manifest.timeoutMinutes * SECONDS_PER_MINUTE),
    },
    // Metered LLM access (ADR 0004): the Anthropic SDK honors these two vars.
    // The "API key" is the per-run gateway bearer token — the real key never
    // enters the sandbox; the gateway meters and forwards.
    { name: 'ANTHROPIC_BASE_URL', value: trimTrailingSlash(config.gatewayUrl) },
    { name: 'ANTHROPIC_API_KEY', value: input.gatewayToken },
    { name: 'AWS_ACCESS_KEY_ID', value: creds.AccessKeyId ?? '' },
    { name: 'AWS_SECRET_ACCESS_KEY', value: creds.SecretAccessKey ?? '' },
    { name: 'AWS_SESSION_TOKEN', value: creds.SessionToken ?? '' },
    // NOTE: we deliberately do NOT set HTTP_PROXY/HTTPS_PROXY. The proxy sidecar
    // is a TRANSPARENT proxy (iptables REDIRECT, SNI/Host peek) with no HTTP
    // CONNECT support; pointing cooperating SDKs (incl. the AWS CLI, which
    // honours HTTPS_PROXY) at it would break `aws s3 sync`. iptables is the sole,
    // sufficient enforcement — see ADR 0003.
    // Plain manifest config after the platform block, before the grant env.
    // Schema validation makes collisions with either unrepresentable (reserved
    // names cover the platform block; a superRefine covers the grants), but
    // ECS applies the last duplicate name, so keep the safe order anyway.
    ...Object.entries(input.manifest.env).map(([name, value]) => ({ name, value })),
    // Per-run tool-grant env appended last (does not disturb the STS creds).
    ...grantEnv,
  ];
}

function buildContainerOverride(args: AppOverrideInput): ContainerOverride {
  const override: ContainerOverride = {
    name: 'app',
    environment: buildEnvironment(args),
  };
  if (args.input.manifest.command) override.command = args.input.manifest.command;
  return override;
}

async function runTask(args: AppOverrideInput): Promise<string> {
  const { input, config } = args;
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
      overrides: {
        containerOverrides: [
          buildContainerOverride(args),
          buildProxyOverride(input.manifest, config.region, [gatewayHost(config.gatewayUrl)]),
        ],
      },
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
  const grantEnv = await resolveGrantEnv(input.manifest, {
    agentId: input.agent.id,
    env: config.env,
  });
  const taskArn = await runTask({ input, config, creds, grantEnv });
  // Kill switch (armed only after RunTask succeeds — it needs the task ARN).
  // On failure this stops the task and throws, so no run escapes its timeout.
  await armRunWatchdog(getEcsClient(), {
    runId: input.runId,
    taskArn,
    clusterArn: config.clusterArn,
    timeoutMinutes: input.manifest.timeoutMinutes,
  });
  logger.info({
    event: 'sandbox.run.launched',
    agentId: input.agent.id,
    runId: input.runId,
    taskArn,
  });
  return taskArn;
}
