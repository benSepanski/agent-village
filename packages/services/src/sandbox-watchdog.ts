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

/**
 * Extra minutes past manifest.timeoutMinutes before the platform-side StopTask
 * fires. The schedule is anchored at RunTask time, but the app's own `timeout`
 * budget only starts after Fargate provisioning, the image pull, and the
 * entrypoint's workspace sync-down — the grace must absorb that startup
 * overhead plus the final sync-up, or a run inside its app-time budget gets
 * killed (and its workspace sync cut mid-flight). 5 minutes covers observed
 * Fargate cold starts with margin; the compute reservation is reconciled to
 * actual duration at stop, so the wider window costs nothing when unused.
 */
export const WATCHDOG_GRACE_MINUTES = 5;
const MS_PER_MINUTE = 60_000;
/**
 * Retries before the fired StopTask is parked in the watchdog DLQ. StopTask can
 * fail transiently at fire time (ECS API throttling), and dropping it would
 * silently lose the run-duration backstop — so the schedule retries, then
 * dead-letters (visible via the watchdog-fire-failed alarm) instead of the old
 * fire-and-forget MaximumRetryAttempts:0.
 */
const WATCHDOG_MAX_RETRY_ATTEMPTS = 10;
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

function watchdogDlqArn(): string {
  const dlqArn = process.env['AV_WATCHDOG_DLQ_ARN'];
  if (!dlqArn) throw new Error('AV_WATCHDOG_DLQ_ARN env var is required');
  return dlqArn;
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
        // StopTask is safe to retry: it returns success on an already-stopped
        // task, so a retry after the task exited on its own is a harmless no-op.
        // Retrying (then dead-lettering) is what protects the backstop from a
        // transient ECS throttle at fire time silently dropping the StopTask.
        RetryPolicy: { MaximumRetryAttempts: WATCHDOG_MAX_RETRY_ATTEMPTS },
        DeadLetterConfig: { Arn: watchdogDlqArn() },
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
