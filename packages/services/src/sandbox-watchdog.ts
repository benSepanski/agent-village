import { type ECSClient, StopTaskCommand } from '@aws-sdk/client-ecs';
import { CreateScheduleCommand, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import type { RunId } from '@agent-village/shared';
import { logger } from './logger.js';
import { getSchedulerClient } from './scheduling.js';

/**
 * Run-duration kill switch (Phase 3 step 01): a one-shot EventBridge Scheduler
 * schedule per launched sandbox task that calls `ecs:StopTask` a small grace
 * period after `manifest.timeoutMinutes`. The launcher arms it right after
 * RunTask; the lifecycle handler deletes it when the task stops on its own.
 * The in-container `timeout` wrapper (entrypoint.sh) is the first line of
 * defense — this schedule is the platform-side backstop for a wedged task.
 */

/** Extra minutes past manifest.timeoutMinutes before the platform-side StopTask fires. */
export const WATCHDOG_GRACE_MINUTES = 2;
const MS_PER_MINUTE = 60_000;
/** ISO-8601 without milliseconds or zone, the `at(...)` format Scheduler expects (UTC). */
const AT_EXPRESSION_LENGTH = 19;

export const watchdogScheduleName = (runId: RunId): string => `run-watchdog-${runId}`;

function watchdogGroup(): string {
  const group = process.env['AV_WATCHDOG_GROUP'];
  if (!group) throw new Error('AV_WATCHDOG_GROUP env var is required');
  return group;
}

function watchdogRoleArn(): string {
  const roleArn = process.env['AV_WATCHDOG_ROLE_ARN'];
  if (!roleArn) throw new Error('AV_WATCHDOG_ROLE_ARN env var is required');
  return roleArn;
}

export interface ArmWatchdogInput {
  runId: RunId;
  taskArn: string;
  clusterArn: string;
  timeoutMinutes: number;
}

function atExpression(minutesFromNow: number): string {
  const fireAt = new Date(Date.now() + minutesFromNow * MS_PER_MINUTE);
  return `at(${fireAt.toISOString().slice(0, AT_EXPRESSION_LENGTH)})`;
}

async function createWatchdogSchedule(input: ArmWatchdogInput): Promise<void> {
  await getSchedulerClient().send(
    new CreateScheduleCommand({
      Name: watchdogScheduleName(input.runId),
      GroupName: watchdogGroup(),
      ScheduleExpression: atExpression(input.timeoutMinutes + WATCHDOG_GRACE_MINUTES),
      FlexibleTimeWindow: { Mode: 'OFF' },
      // Self-cleanup after firing, so a missed lifecycle delete cannot leak schedules.
      ActionAfterCompletion: 'DELETE',
      Target: {
        // Universal target: the Input keys are the ECS StopTask API request
        // parameters (camelCase, per the ECS API reference).
        Arn: 'arn:aws:scheduler:::aws-sdk:ecs:stopTask',
        RoleArn: watchdogRoleArn(),
        Input: JSON.stringify({
          cluster: input.clusterArn,
          task: input.taskArn,
          // "timed out" is a marker finalizeSandboxRun maps to status 'timed_out'.
          reason: `run timed out: exceeded manifest timeout of ${input.timeoutMinutes} minutes`,
        }),
        // If the task already stopped, StopTask can never succeed — don't retry.
        RetryPolicy: { MaximumRetryAttempts: 0 },
      },
    }),
  );
}

async function stopTaskQuietly(ecs: ECSClient, input: ArmWatchdogInput): Promise<void> {
  try {
    await ecs.send(
      new StopTaskCommand({
        cluster: input.clusterArn,
        task: input.taskArn,
        reason: 'run watchdog could not be armed',
      }),
    );
  } catch (err) {
    // Best effort: the in-container `timeout` fallback still bounds the run.
    logger.warn({ event: 'sandbox.watchdog.arm_failed', runId: input.runId, err });
  }
}

/**
 * Arm the kill switch for a just-launched task. If the schedule cannot be
 * created the task would run unwatched, so the launch is aborted: the task is
 * stopped (best effort) and the error rethrown for launch-failure handling.
 */
export async function armRunWatchdog(ecs: ECSClient, input: ArmWatchdogInput): Promise<void> {
  try {
    await createWatchdogSchedule(input);
  } catch (err) {
    logger.error({ event: 'sandbox.watchdog.arm_failed', runId: input.runId, err });
    await stopTaskQuietly(ecs, input);
    throw err;
  }
  logger.info({ event: 'sandbox.watchdog.armed', runId: input.runId, taskArn: input.taskArn });
}

/**
 * Disarm the kill switch once the task has stopped. Best effort by design: a
 * missing schedule (already fired and self-deleted) is the expected race, and
 * any other failure is logged, not thrown — the schedule self-deletes after
 * firing, and StopTask on a finished task is harmless.
 */
export async function deleteRunWatchdog(runId: RunId): Promise<void> {
  try {
    await getSchedulerClient().send(
      new DeleteScheduleCommand({ Name: watchdogScheduleName(runId), GroupName: watchdogGroup() }),
    );
  } catch (err) {
    if (err instanceof Error && err.name === 'ResourceNotFoundException') return;
    logger.warn({ event: 'sandbox.watchdog.delete_failed', runId, err });
    return;
  }
  logger.info({ event: 'sandbox.watchdog.deleted', runId });
}
