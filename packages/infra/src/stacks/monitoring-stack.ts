import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import { AnyPrincipal, Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../../config/index.js';

export interface MonitoringStackProps extends StackProps {
  readonly config: EnvConfig;
}

export class MonitoringStack extends Stack {
  public readonly alarmTopic: Topic;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.alarmTopic = new Topic(this, 'AlarmTopic', {
      topicName: `${config.prefix}-alarms`,
      displayName: `${config.prefix} alarms`,
      enforceSSL: true,
    });
    this.alarmTopic.addToResourcePolicy(
      new PolicyStatement({
        sid: 'DenyNonTLS',
        effect: Effect.DENY,
        principals: [new AnyPrincipal()],
        actions: ['sns:Publish'],
        resources: [this.alarmTopic.topicArn],
        conditions: { Bool: { 'aws:SecureTransport': 'false' } },
      }),
    );
    this.alarmTopic.addSubscription(new EmailSubscription(config.alarmEmail));

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

    new CfnOutput(this, 'AlarmTopicArn', { value: this.alarmTopic.topicArn });
  }
}
