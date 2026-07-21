import { Effect, PolicyStatement, type Role } from 'aws-cdk-lib/aws-iam';
import type { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { EnvConfig } from '../../config/index.js';
import type { ApiStackProps, HandlerSpec } from './api-stack-types.js';

/**
 * IAM/env grant helpers for ApiStack's per-handler Lambdas. Split out of
 * api-stack.ts by topic (route/handler wiring vs. permission grants) to stay
 * under the 300-line file bound (docs/conventions/file-size-bounds.md).
 */

/**
 * secretsmanager:ListSecrets supports no resource-level scoping — '*' is the
 * only grantable resource; the handler narrows results with a name-prefix
 * filter in code. agents-delete needs it too for its orphan-secret sweep.
 */
export function grantSecretsList(fn: NodejsFunction): void {
  fn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['secretsmanager:ListSecrets'],
      resources: ['*'],
    }),
  );
}

/** FilterLogEvents over the sandbox task log group (account-wildcarded for credential-free synth). */
export function grantSandboxLogsRead(fn: NodejsFunction, config: EnvConfig): void {
  const logGroupArn = `arn:aws:logs:${config.region}:*:log-group:${config.prefix}-sandbox`;
  fn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['logs:FilterLogEvents', 'logs:GetLogEvents'],
      resources: [logGroupArn, `${logGroupArn}:*`],
    }),
  );
}

export function grantSecretsCrud(fn: NodejsFunction, config: EnvConfig): void {
  fn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'secretsmanager:CreateSecret',
        'secretsmanager:GetSecretValue',
        'secretsmanager:PutSecretValue',
        'secretsmanager:DeleteSecret',
      ],
      resources: [
        `arn:aws:secretsmanager:${config.region}:*:secret:agent-village/${config.env}/agents/*`,
      ],
    }),
  );
}

export function grantSchedulerCrud(fn: NodejsFunction, schedulerInvokeRole: Role): void {
  fn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'scheduler:CreateSchedule',
        'scheduler:UpdateSchedule',
        'scheduler:DeleteSchedule',
        'scheduler:GetSchedule',
      ],
      resources: ['*'],
    }),
  );
  fn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [schedulerInvokeRole.roleArn],
    }),
  );
}

export function grantRunNowExtras(fn: NodejsFunction, props: ApiStackProps): void {
  props.runnerFunction.grantInvoke(fn);
  fn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['secretsmanager:GetSecretValue'],
      resources: [
        `arn:aws:secretsmanager:${props.config.region}:*:secret:agent-village/${props.config.env}/agents/*/anthropic-key-*`,
      ],
    }),
  );
}

/**
 * Direct S3 access to an agent's workspace prefix (Phase 5 step 01). Both
 * handlers get the bucket name; list only needs to enumerate keys (each
 * request is narrowed to the caller's own prefix by the ownership-checked
 * service call, not by IAM — ListBucket has no key-prefix condition worth
 * adding here since the handler itself never returns another agent's keys),
 * presign needs get/put/delete on individual objects since the presigned URL
 * itself is the object-level scope handed to the client.
 */
export function grantWorkspaceExtras(
  fn: NodejsFunction,
  props: ApiStackProps,
  spec: HandlerSpec,
): void {
  fn.addEnvironment('AV_WORKSPACE_BUCKET', props.workspaceBucket.bucketName);
  if (spec.name === 'agents-workspace-list') {
    fn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['s3:ListBucket'],
        resources: [props.workspaceBucket.bucketArn],
      }),
    );
  } else {
    fn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        resources: [`${props.workspaceBucket.bucketArn}/*`],
      }),
    );
  }
}

export function toRetention(days: number): RetentionDays {
  if (days <= 1) return RetentionDays.ONE_DAY;
  if (days <= 3) return RetentionDays.THREE_DAYS;
  if (days <= 7) return RetentionDays.ONE_WEEK;
  if (days <= 14) return RetentionDays.TWO_WEEKS;
  if (days <= 30) return RetentionDays.ONE_MONTH;
  return RetentionDays.SIX_MONTHS;
}
