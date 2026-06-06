import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
  SchedulerClient,
  type Target,
  UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import type { AgentId } from '@agent-village/shared';
import { logger } from './logger.js';

export interface SchedulingConfig {
  groupName: string;
  runnerLambdaArn: string;
  schedulerRoleArn: string;
}

let cached: SchedulerClient | undefined;

export function getSchedulerClient(): SchedulerClient {
  cached ??= new SchedulerClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
  return cached;
}

export function resetSchedulerClient(): void {
  cached = undefined;
}

/** Test-only: inject a mock SchedulerClient. */
export function setSchedulerClient(client: SchedulerClient): void {
  cached = client;
}

export function getSchedulingConfig(): SchedulingConfig {
  const groupName = process.env['AV_SCHEDULER_GROUP'];
  const runnerLambdaArn = process.env['AV_RUNNER_LAMBDA_ARN'];
  const schedulerRoleArn = process.env['AV_SCHEDULER_ROLE_ARN'];
  if (!groupName || !runnerLambdaArn || !schedulerRoleArn) {
    throw new Error(
      'AV_SCHEDULER_GROUP, AV_RUNNER_LAMBDA_ARN, AV_SCHEDULER_ROLE_ARN env vars are required',
    );
  }
  return { groupName, runnerLambdaArn, schedulerRoleArn };
}

const scheduleName = (agentId: AgentId): string => `agent-${agentId}`;

const DOW_DAYS_IN_WEEK = 7;

/**
 * Remap a single day-of-week token from Unix numbering (0-6, Sunday=0, also 7)
 * to EventBridge numbering (1-7, Sunday=1). Day names (SUN-SAT), `*` and `?`
 * carry the same meaning in both dialects and pass through unchanged.
 */
function remapDowToken(token: string): string {
  if (/^\d+$/.test(token)) {
    return String((Number(token) % DOW_DAYS_IN_WEEK) + 1);
  }
  return token;
}

/** Remap the day, but preserve cron operators (`,` `-` `/` `#` `L`) around numbers. */
function remapDowField(field: string): string {
  if (field === '*' || field === '?') return field;
  return field
    .split(',')
    .map((part) => {
      const slash = part.indexOf('/');
      if (slash !== -1) return remapDowField(part.slice(0, slash)) + part.slice(slash);
      const hash = part.indexOf('#');
      if (hash !== -1) return remapDowToken(part.slice(0, hash)) + part.slice(hash);
      if (part.endsWith('L')) return remapDowToken(part.slice(0, -1)) + 'L';
      const dash = part.indexOf('-');
      if (dash > 0) {
        return `${remapDowToken(part.slice(0, dash))}-${remapDowToken(part.slice(dash + 1))}`;
      }
      return remapDowToken(part);
    })
    .join(',');
}

/** Standard 5-field cron → EventBridge 6-field cron(...). Passes through cron(...) and rate(...). */
export function toEventBridgeExpression(expr: string): string {
  if (expr.startsWith('cron(') || expr.startsWith('rate(')) return expr;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`expected 5-field cron, got ${parts.length} fields: ${expr}`);
  }
  const min = parts[0]!;
  const hour = parts[1]!;
  let dom = parts[2]!;
  const month = parts[3]!;
  let dow = parts[4]!;
  if (dom === '*' && dow === '*') dow = '?';
  else if (dom === '*') dom = '?';
  else if (dow === '*') dow = '?';
  // Unix DOW (Sun=0) and EventBridge DOW (Sun=1) differ; remap numeric days.
  dow = remapDowField(dow);
  return `cron(${min} ${hour} ${dom} ${month} ${dow} *)`;
}

function buildTarget(agentId: AgentId, config: SchedulingConfig): Target {
  return {
    Arn: config.runnerLambdaArn,
    RoleArn: config.schedulerRoleArn,
    Input: JSON.stringify({ agentId }),
  };
}

export async function upsertSchedule(agentId: AgentId, scheduleExpr: string): Promise<void> {
  const config = getSchedulingConfig();
  const client = getSchedulerClient();
  const params = {
    Name: scheduleName(agentId),
    GroupName: config.groupName,
    ScheduleExpression: toEventBridgeExpression(scheduleExpr),
    FlexibleTimeWindow: { Mode: 'OFF' as const },
    Target: buildTarget(agentId, config),
  };
  try {
    await client.send(new CreateScheduleCommand(params));
  } catch (err) {
    if (err instanceof Error && err.name === 'ConflictException') {
      await client.send(new UpdateScheduleCommand(params));
    } else throw err;
  }
  logger.info({ event: 'schedule.upserted', agentId, schedule: scheduleExpr });
}

export async function removeSchedule(agentId: AgentId): Promise<void> {
  const config = getSchedulingConfig();
  try {
    await getSchedulerClient().send(
      new DeleteScheduleCommand({ Name: scheduleName(agentId), GroupName: config.groupName }),
    );
  } catch (err) {
    if (err instanceof Error && err.name === 'ResourceNotFoundException') return;
    throw err;
  }
  logger.info({ event: 'schedule.removed', agentId });
}
