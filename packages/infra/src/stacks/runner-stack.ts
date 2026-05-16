import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { CfnScheduleGroup } from 'aws-cdk-lib/aws-scheduler';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../../config/index.js';

export interface RunnerStackProps extends StackProps {
  readonly config: EnvConfig;
  readonly table: Table;
}

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_ENTRY = path.resolve(SELF_DIR, '../../../runner/src/handler.ts');

export class RunnerStack extends Stack {
  public readonly runnerFunction: NodejsFunction;
  public readonly scheduleGroupName: string;
  public readonly schedulerInvokeRole: Role;

  constructor(scope: Construct, id: string, props: RunnerStackProps) {
    super(scope, id, props);
    const groupName = `${props.config.prefix}-agents`;
    new CfnScheduleGroup(this, 'ScheduleGroup', { name: groupName });
    this.scheduleGroupName = groupName;

    this.runnerFunction = this.buildRunnerFunction(props);
    this.schedulerInvokeRole = this.buildSchedulerInvokeRole(props.config.prefix);

    new CfnOutput(this, 'RunnerFunctionArn', { value: this.runnerFunction.functionArn });
    new CfnOutput(this, 'ScheduleGroupName', { value: groupName });
    new CfnOutput(this, 'SchedulerInvokeRoleArn', { value: this.schedulerInvokeRole.roleArn });
  }

  private buildRunnerFunction(props: RunnerStackProps): NodejsFunction {
    const { config, table } = props;
    const logGroup = new LogGroup(this, 'RunnerLogs', {
      logGroupName: `/aws/lambda/${config.prefix}-runner`,
      retention: toRetention(config.logRetentionDays),
      removalPolicy: config.retainOnDelete ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    const fn = new NodejsFunction(this, 'RunnerFunction', {
      functionName: `${config.prefix}-runner`,
      entry: RUNNER_ENTRY,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: config.runnerMemoryMb,
      timeout: Duration.seconds(60),
      logGroup,
      environment: { AV_ENV: config.env, AV_TABLE_NAME: table.tableName, AV_REGION: config.region },
      bundling: {
        format: OutputFormat.ESM,
        target: 'node22',
        minify: true,
        externalModules: ['@aws-sdk/*'],
        banner:
          "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
      },
    });
    table.grantReadWriteData(fn);
    fn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${config.region}:*:secret:agent-village/${config.env}/agents/*/anthropic-key-*`,
        ],
      }),
    );
    return fn;
  }

  private buildSchedulerInvokeRole(prefix: string): Role {
    const role = new Role(this, 'SchedulerInvokeRole', {
      roleName: `${prefix}-scheduler-invoke`,
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
    });
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [this.runnerFunction.functionArn],
      }),
    );
    return role;
  }
}

function toRetention(days: number): RetentionDays {
  if (days <= 1) return RetentionDays.ONE_DAY;
  if (days <= 3) return RetentionDays.THREE_DAYS;
  if (days <= 7) return RetentionDays.ONE_WEEK;
  if (days <= 14) return RetentionDays.TWO_WEEKS;
  if (days <= 30) return RetentionDays.ONE_MONTH;
  return RetentionDays.SIX_MONTHS;
}
