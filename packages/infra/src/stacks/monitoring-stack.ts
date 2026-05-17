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
import type { Construct } from 'constructs';
import type { EnvConfig } from '../../config/index.js';

export interface MonitoringStackProps extends StackProps {
  readonly config: EnvConfig;
  readonly runnerFunction: IFunction;
}

const RUNNER_DURATION_P95_MS = 30_000;

export class MonitoringStack extends Stack {
  public readonly alarmTopic: Topic;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);
    const { config, runnerFunction } = props;

    this.alarmTopic = this.buildAlarmTopic(config);
    this.buildBudget(config);

    const action = new SnsAction(this.alarmTopic);
    this.buildRunnerAlarms(config, runnerFunction, action);
    this.buildSpendAlarm(config, action);

    new CfnOutput(this, 'AlarmTopicArn', { value: this.alarmTopic.topicArn });
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

    new Alarm(this, 'RunnerEmfErrorsAlarm', {
      alarmName: `${config.prefix}-runs-error-count`,
      alarmDescription: 'EMF runs.error metric above zero (status=error runs)',
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

  private buildSpendAlarm(config: EnvConfig, action: SnsAction): void {
    new Alarm(this, 'SpendRejectedAlarm', {
      alarmName: `${config.prefix}-spend-rejected`,
      alarmDescription: 'A run was rejected by the spend-limit conditional check',
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
}
