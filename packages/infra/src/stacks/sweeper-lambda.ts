import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { type BundlingOptions, NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../../config/index.js';
import { toRetention } from './log-retention.js';
import { watchdogScheduleArnPattern } from './runner-iam.js';

/**
 * Stuck-run sweeper Lambda, split out of runner-stack.ts (file-size bound):
 * finalizes sandbox runs wedged in `running` past their maximum lifetime via
 * the same lifecycle settlement path (idempotent, fail-safe). Mirrors the
 * lifecycle Lambda's env + IAM: it reads/writes the table and disarms the
 * per-run watchdog schedule as finalization does.
 */

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const SWEEPER_ENTRY = path.resolve(SELF_DIR, '../../../runner/src/sweeper.ts');

/** How often the stuck-run sweeper reconciles runs wedged in `running`. */
const SWEEPER_RATE_MINUTES = 5;

export interface BuildSweeperFunctionProps {
  readonly config: EnvConfig;
  readonly table: Table;
  readonly watchdogGroupName: string;
  /** Same esbuild settings the rest of the runner Lambdas use. */
  readonly bundling: BundlingOptions;
}

export function buildSweeperFunction(
  scope: Construct,
  props: BuildSweeperFunctionProps,
): NodejsFunction {
  const { config, table, watchdogGroupName, bundling } = props;
  const fn = new NodejsFunction(scope, 'SweeperFunction', {
    functionName: `${config.prefix}-sweeper`,
    entry: SWEEPER_ENTRY,
    handler: 'handler',
    runtime: Runtime.NODEJS_22_X,
    architecture: Architecture.ARM_64,
    memorySize: config.runnerMemoryMb,
    timeout: Duration.seconds(60),
    logGroup: new LogGroup(scope, 'SweeperLogs', {
      logGroupName: `/aws/lambda/${config.prefix}-sweeper`,
      retention: toRetention(config.logRetentionDays),
      removalPolicy: config.retainOnDelete ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    }),
    environment: {
      AV_ENV: config.env,
      AV_TABLE_NAME: table.tableName,
      AV_REGION: config.region,
      AV_WATCHDOG_GROUP: watchdogGroupName,
      // Reconciliation prices actual duration with the launcher's task size.
      AV_SANDBOX_CPU: String(config.sandboxTaskCpu),
      AV_SANDBOX_MEMORY: String(config.sandboxTaskMemoryMb),
    },
    bundling,
  });
  table.grantReadWriteData(fn);
  // Finalization disarms the per-run kill-switch schedule (best effort).
  fn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['scheduler:DeleteSchedule'],
      resources: [watchdogScheduleArnPattern(config, watchdogGroupName)],
    }),
  );
  new Rule(scope, 'StuckRunSweep', {
    ruleName: `${config.prefix}-stuck-run-sweep`,
    schedule: Schedule.rate(Duration.minutes(SWEEPER_RATE_MINUTES)),
    targets: [new LambdaFunction(fn)],
  });
  return fn;
}
