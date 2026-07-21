import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import {
  Alarm,
  ComparisonOperator,
  Metric,
  TreatMissingData,
  Unit,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { AnyPrincipal, Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import type { IQueue } from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../../config/index.js';

export interface MonitoringStackProps extends StackProps {
  readonly config: EnvConfig;
  readonly runnerFunction: IFunction;
  /** Async sandbox-run finalizer; its failure silently wedges an agent's slot. */
  readonly lifecycleFunction: IFunction;
  /** Metering gateway (ADR 0004); enforces the hard spend cap for sandbox LLM calls. */
  readonly gatewayFunction: IFunction;
  /** Stuck-run sweeper (Lambda-error alarm). */
  readonly sweeperFunction: IFunction;
  /** Report-only budget-drift reconciliation job (M3; Lambda-error + EMF alarms). */
  readonly budgetDriftFunction: IFunction;
  /** DLQ for stop events EventBridge could not deliver to the lifecycle Lambda. */
  readonly lifecycleDlq: IQueue;
  /** DLQ for watchdog StopTask fires that failed at fire time. */
  readonly watchdogDlq: IQueue;
}

const RUNNER_DURATION_P95_MS = 30_000;
// The gateway buffers a whole LLM response synchronously and the lifecycle
// finalizer does a few DynamoDB writes; both should complete well under a minute.
const ASYNC_LAMBDA_DURATION_P95_MS = 60_000;

export class MonitoringStack extends Stack {
  public readonly alarmTopic: Topic;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);
    const { config, runnerFunction, lifecycleFunction, gatewayFunction } = props;

    this.alarmTopic = this.buildAlarmTopic(config);
    this.buildBudget(config);

    const action = new SnsAction(this.alarmTopic);
    this.buildRunnerAlarms(config, runnerFunction, action);
    // The lifecycle and gateway Lambdas are separate functions from the runner,
    // so the runner alarms above never see their errors. Both are on the
    // critical path — a wedged finalizer strands an agent's one-run slot, and a
    // failing gateway breaks metered LLM access for every sandbox run — so each
    // gets its own error + p95-duration alarm.
    this.buildFunctionAlarms(config, 'lifecycle', lifecycleFunction, action);
    this.buildFunctionAlarms(config, 'gateway', gatewayFunction, action);
    this.buildSpendAlarm(config, action);
    this.buildResilienceAlarms(config, props, action);
    this.buildBudgetDriftAlarms(config, props.budgetDriftFunction, action);

    new CfnOutput(this, 'AlarmTopicArn', { value: this.alarmTopic.topicArn });
  }

  /** Error + p95-duration alarms for a critical async Lambda (lifecycle/gateway). */
  private buildFunctionAlarms(
    config: EnvConfig,
    name: string,
    fn: IFunction,
    action: SnsAction,
  ): void {
    new Alarm(this, `${name}ErrorsAlarm`, {
      alarmName: `${config.prefix}-${name}-errors`,
      alarmDescription: `${name} Lambda error invocations`,
      metric: fn.metricErrors({ period: Duration.minutes(5), statistic: 'Sum' }),
      evaluationPeriods: 1,
      threshold: 0,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(action);

    new Alarm(this, `${name}DurationP95Alarm`, {
      alarmName: `${config.prefix}-${name}-duration-p95`,
      alarmDescription: `${name} Lambda p95 duration above 60s`,
      metric: fn.metricDuration({ period: Duration.minutes(5), statistic: 'p95' }),
      evaluationPeriods: 2,
      threshold: ASYNC_LAMBDA_DURATION_P95_MS,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(action);
  }

  private buildAlarmTopic(config: EnvConfig): Topic {
    const topic = new Topic(this, 'AlarmTopic', {
      topicName: `${config.prefix}-alarms`,
      displayName: `${config.prefix} alarms`,
      enforceSSL: true,
    });
    topic.addToResourcePolicy(
      new PolicyStatement({
        sid: 'DenyNonTLS',
        effect: Effect.DENY,
        principals: [new AnyPrincipal()],
        actions: ['sns:Publish'],
        resources: [topic.topicArn],
        conditions: { Bool: { 'aws:SecureTransport': 'false' } },
      }),
    );
    topic.addSubscription(new EmailSubscription(config.alarmEmail));
    return topic;
  }

  private buildBudget(config: EnvConfig): void {
    new CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `${config.prefix}-monthly`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: config.monthlyBudgetUsd, unit: 'USD' },
      },
      notificationsWithSubscribers: [50, 80, 100].map((threshold) => ({
        notification: {
          notificationType: 'ACTUAL',
          comparisonOperator: 'GREATER_THAN',
          threshold,
          thresholdType: 'PERCENTAGE',
        },
        subscribers: [{ subscriptionType: 'EMAIL', address: config.alarmEmail }],
      })),
    });
  }

  private buildRunnerAlarms(config: EnvConfig, runnerFn: IFunction, action: SnsAction): void {
    new Alarm(this, 'RunnerErrorsAlarm', {
      alarmName: `${config.prefix}-runner-errors`,
      alarmDescription: 'Runner Lambda error invocations',
      metric: runnerFn.metricErrors({ period: Duration.minutes(5), statistic: 'Sum' }),
      evaluationPeriods: 1,
      threshold: 0,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(action);

    new Alarm(this, 'RunnerDurationP95Alarm', {
      alarmName: `${config.prefix}-runner-duration-p95`,
      alarmDescription: 'Runner Lambda p95 duration above 30s',
      metric: runnerFn.metricDuration({ period: Duration.minutes(5), statistic: 'p95' }),
      evaluationPeriods: 2,
      threshold: RUNNER_DURATION_P95_MS,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(action);

    // Emitted (EMF) from the terminal-status log lines in @agent-village/services
    // via runOutcomeMetric: status=error and status=launch_failed runs.
    new Alarm(this, 'RunnerEmfErrorsAlarm', {
      alarmName: `${config.prefix}-runs-error-count`,
      alarmDescription: 'EMF runs.error metric above zero (status=error / launch_failed runs)',
      metric: new Metric({
        namespace: 'AgentVillage',
        metricName: 'runs.error',
        period: Duration.minutes(5),
        statistic: 'Sum',
        unit: Unit.COUNT,
      }),
      evaluationPeriods: 1,
      threshold: 0,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(action);
  }

  /**
   * Availability backstops (production-readiness): a stop event dead-lettered
   * after the lifecycle finalizer could not be reached, a watchdog StopTask
   * that failed to fire, and errors from the stuck-run sweeper. Any of these
   * means a run's one-slot lifecycle needs a human look, so each pages the
   * same alarm topic — modeled on the runner/spend alarms above.
   */
  private buildResilienceAlarms(
    config: EnvConfig,
    props: MonitoringStackProps,
    action: SnsAction,
  ): void {
    this.buildDlqAlarm(
      'LifecycleDlqAlarm',
      `${config.prefix}-lifecycle-dlq`,
      'A sandbox stop event was dead-lettered (lifecycle finalizer unreachable)',
      props.lifecycleDlq,
    ).addAlarmAction(action);

    this.buildDlqAlarm(
      'WatchdogDlqAlarm',
      `${config.prefix}-watchdog-dlq`,
      'A run-duration watchdog StopTask failed to fire and was dead-lettered',
      props.watchdogDlq,
    ).addAlarmAction(action);

    new Alarm(this, 'SweeperErrorsAlarm', {
      alarmName: `${config.prefix}-sweeper-errors`,
      alarmDescription: 'Stuck-run sweeper Lambda error invocations',
      metric: props.sweeperFunction.metricErrors({ period: Duration.minutes(5), statistic: 'Sum' }),
      evaluationPeriods: 1,
      threshold: 0,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(action);
  }

  private buildDlqAlarm(id: string, name: string, description: string, dlq: IQueue): Alarm {
    return new Alarm(this, id, {
      alarmName: name,
      alarmDescription: description,
      // Any message in a DLQ is a delivery/backstop failure worth a look.
      metric: dlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: 'Maximum',
      }),
      evaluationPeriods: 1,
      threshold: 0,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
  }

  private buildSpendAlarm(config: EnvConfig, action: SnsAction): void {
    // Emitted (EMF) via runOutcomeMetric at reserve-time rejections and at
    // sandbox finalization of a mid-run (gateway-marked) breach.
    new Alarm(this, 'SpendRejectedAlarm', {
      alarmName: `${config.prefix}-spend-rejected`,
      alarmDescription: 'A run was rejected or stopped by the spend limit',
      metric: new Metric({
        namespace: 'AgentVillage',
        metricName: 'runs.spend_limit_exceeded',
        period: Duration.hours(1),
        statistic: 'Sum',
        unit: Unit.COUNT,
      }),
      evaluationPeriods: 1,
      threshold: 0,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(action);
  }

  /**
   * Report-only drift job (M3): an error alarm on the Lambda itself, plus the
   * EMF `budget.drift_usd` gauge it emits once per recomputed scope (agent or
   * user window) each pass — alarm on `Maximum` exceeding the configured
   * threshold, since any single scope drifting past it is worth a look even
   * if most scopes are exact.
   */
  private buildBudgetDriftAlarms(
    config: EnvConfig,
    budgetDriftFunction: IFunction,
    action: SnsAction,
  ): void {
    new Alarm(this, 'BudgetDriftErrorsAlarm', {
      alarmName: `${config.prefix}-budget-drift-errors`,
      alarmDescription: 'Budget-drift reconciliation Lambda error invocations',
      metric: budgetDriftFunction.metricErrors({ period: Duration.hours(1), statistic: 'Sum' }),
      evaluationPeriods: 1,
      threshold: 0,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(action);

    new Alarm(this, 'BudgetDriftAlarm', {
      alarmName: `${config.prefix}-budget-drift`,
      alarmDescription: `A recomputed spend accumulator drifted more than $${config.budgetDriftThresholdUsd} from its persisted value`,
      metric: new Metric({
        namespace: 'AgentVillage',
        metricName: 'budget.drift_usd',
        period: Duration.hours(1),
        statistic: 'Maximum',
        unit: Unit.NONE,
      }),
      evaluationPeriods: 1,
      threshold: config.budgetDriftThresholdUsd,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(action);
  }
}
