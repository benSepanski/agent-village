import { Duration } from 'aws-cdk-lib';
import { Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import type { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../../config/index.js';

/**
 * A dead-letter queue: SSL-enforced (AwsSolutions-SQS4). Being itself a DLQ, it
 * has no onward redrive — AwsSolutions-SQS3 is suppressed at the stack level in
 * bin/app.ts.
 */
export function buildDlq(scope: Construct, id: string, queueName: string): Queue {
  return new Queue(scope, id, {
    queueName,
    enforceSSL: true,
    // Long enough that a multi-day outage still leaves the evidence to replay.
    retentionPeriod: Duration.days(14),
  });
}

/** Role EventBridge Scheduler assumes to fire the per-run `ecs:StopTask` watchdog. */
export function buildWatchdogStopTaskRole(scope: Construct, config: EnvConfig): Role {
  const role = new Role(scope, 'WatchdogStopTaskRole', {
    roleName: `${config.prefix}-run-watchdog`,
    assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
  });
  role.addToPolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['ecs:StopTask'],
      resources: [sandboxTaskArnPattern(config)],
    }),
  );
  return role;
}

/** ECS task ARNs in the sandbox cluster; account-wildcarded for credential-free synth. */
export function sandboxTaskArnPattern(config: EnvConfig): string {
  return `arn:aws:ecs:${config.region}:*:task/${config.prefix}-sandbox/*`;
}

/** Watchdog schedule ARNs; account-wildcarded for credential-free synth. */
export function watchdogScheduleArnPattern(config: EnvConfig, watchdogGroupName: string): string {
  return `arn:aws:scheduler:${config.region}:*:schedule/${watchdogGroupName}/*`;
}

/** Sandbox task-definition revision ARNs; account-wildcarded for credential-free synth. */
export function sandboxTaskDefArnPattern(config: EnvConfig): string {
  return `arn:aws:ecs:${config.region}:*:task-definition/${config.prefix}-sandbox:*`;
}

export function grantSecretRead(fn: NodejsFunction, config: EnvConfig): void {
  const prefix = `arn:aws:secretsmanager:${config.region}:*:secret:agent-village/${config.env}/agents`;
  fn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['secretsmanager:GetSecretValue'],
      // Per-agent secrets: the Anthropic key, the typed tool-grant secrets
      // (Notion token, GitHub PAT), and generic `secret` grants whose leaf
      // names are user-chosen — hence the full per-agent prefix. Reserved
      // platform leaves are still unreachable from manifests: the schema and
      // resolveGrantEnv both reject them (isReservedSecretLeaf).
      resources: [`${prefix}/*`],
    }),
  );
}

export function grantSandboxLaunch(
  fn: NodejsFunction,
  config: EnvConfig,
  sandboxTaskRoleArn: string,
  sandboxExecutionRoleArn: string,
): void {
  fn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      // DescribeTaskDefinition: the launcher clones the static definition
      // when a manifest names a custom image tag (Phase 4 step 03) — same
      // family scope as RunTask, so a clone can only be derived from (and
      // run as) the sandbox family.
      actions: ['ecs:RunTask', 'ecs:DescribeTaskDefinition'],
      // Account-wildcarded so the cdk-nag suppression is deterministic when
      // synthesizing without credentials; the family name is the real scope.
      resources: [sandboxTaskDefArnPattern(config)],
    }),
  );
  fn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['ecs:RegisterTaskDefinition'],
      // ECS supports no resource-level scoping for RegisterTaskDefinition.
      // The real guardrail is the iam:PassRole pin below: whatever gets
      // registered can only run with the two sandbox roles.
      resources: ['*'],
    }),
  );
  fn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [sandboxTaskRoleArn, sandboxExecutionRoleArn],
      conditions: { StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' } },
    }),
  );
}

/**
 * Kill-switch arming for the launcher: create the per-run one-shot StopTask
 * schedule (DeleteSchedule is included because the schedule is created with
 * ActionAfterCompletion=DELETE), pass the scheduler-assumed StopTask role,
 * and stop the just-launched task directly when arming fails.
 */
export function grantWatchdogArm(
  fn: NodejsFunction,
  config: EnvConfig,
  watchdogGroupName: string,
  watchdogStopTaskRoleArn: string,
): void {
  fn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['scheduler:CreateSchedule', 'scheduler:DeleteSchedule'],
      resources: [watchdogScheduleArnPattern(config, watchdogGroupName)],
    }),
  );
  fn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [watchdogStopTaskRoleArn],
      conditions: { StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' } },
    }),
  );
  fn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['ecs:StopTask'],
      resources: [sandboxTaskArnPattern(config)],
    }),
  );
}
