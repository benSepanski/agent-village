import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { type BundlingOptions, NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../../config/index.js';
import { toRetention } from './log-retention.js';

/**
 * Report-only budget-drift job (M3), split out of runner-stack.ts (file-size
 * bound): recomputes every agent's lifetime spend and every budgeted user's
 * current-month window from run records and emits the `budget.drift_usd` EMF
 * gauge the monitoring stack alarms on. It never writes a correction, so —
 * unlike the sweeper — it only needs table READ access and no
 * watchdog/scheduler IAM at all.
 */

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const BUDGET_DRIFT_ENTRY = path.resolve(SELF_DIR, '../../../runner/src/budget-drift.ts');

/**
 * How often the job recomputes accumulators. Coarser than the stuck-run
 * sweeper's cadence — this is an observability backstop, not a live-run
 * settlement path.
 */
const BUDGET_DRIFT_RATE_MINUTES = 60;

export interface BuildBudgetDriftFunctionProps {
  readonly config: EnvConfig;
  readonly table: Table;
  /** Same esbuild settings the rest of the runner Lambdas use. */
  readonly bundling: BundlingOptions;
}

export function buildBudgetDriftFunction(
  scope: Construct,
  props: BuildBudgetDriftFunctionProps,
): NodejsFunction {
  const { config, table, bundling } = props;
  const fn = new NodejsFunction(scope, 'BudgetDriftFunction', {
    functionName: `${config.prefix}-budget-drift`,
    entry: BUDGET_DRIFT_ENTRY,
    handler: 'handler',
    runtime: Runtime.NODEJS_22_X,
    architecture: Architecture.ARM_64,
    memorySize: config.runnerMemoryMb,
    // A full-table scan (listAllAgents/listAllProfiles) plus a per-scope query
    // each; generous relative to the sweeper, still well under the hourly cadence.
    timeout: Duration.minutes(5),
    logGroup: new LogGroup(scope, 'BudgetDriftLogs', {
      logGroupName: `/aws/lambda/${config.prefix}-budget-drift`,
      retention: toRetention(config.logRetentionDays),
      removalPolicy: config.retainOnDelete ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    }),
    environment: {
      AV_ENV: config.env,
      AV_TABLE_NAME: table.tableName,
      AV_REGION: config.region,
      AV_BUDGET_DRIFT_THRESHOLD_USD: String(config.budgetDriftThresholdUsd),
    },
    bundling,
  });
  table.grantReadData(fn);
  new Rule(scope, 'BudgetDriftSchedule', {
    ruleName: `${config.prefix}-budget-drift`,
    schedule: Schedule.rate(Duration.minutes(BUDGET_DRIFT_RATE_MINUTES)),
    targets: [new LambdaFunction(fn)],
  });
  return fn;
}
