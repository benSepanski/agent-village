import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Rule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { type BundlingOptions, NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { CfnScheduleGroup } from 'aws-cdk-lib/aws-scheduler';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../../config/index.js';
import { toRetention } from './log-retention.js';
import type { SandboxStack } from './sandbox-stack.js';

export interface RunnerStackProps extends StackProps {
  readonly config: EnvConfig;
  readonly table: Table;
  readonly sandbox: SandboxStack;
}

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_ENTRY = path.resolve(SELF_DIR, '../../../runner/src/handler.ts');
const LIFECYCLE_ENTRY = path.resolve(SELF_DIR, '../../../runner/src/lifecycle.ts');

const BUNDLING: BundlingOptions = {
  format: OutputFormat.ESM,
  target: 'node22',
  minify: true,
  externalModules: ['@aws-sdk/*'],
  banner: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
};

export class RunnerStack extends Stack {
  public readonly runnerFunction: NodejsFunction;
  public readonly lifecycleFunction: NodejsFunction;
  public readonly scheduleGroupName: string;
  public readonly schedulerInvokeRole: Role;

  constructor(scope: Construct, id: string, props: RunnerStackProps) {
    super(scope, id, props);
    const groupName = `${props.config.prefix}-agents`;
    new CfnScheduleGroup(this, 'ScheduleGroup', { name: groupName });
    this.scheduleGroupName = groupName;

    this.runnerFunction = this.buildRunnerFunction(props);
    this.lifecycleFunction = this.buildLifecycleFunction(props);
    this.buildTaskStoppedRule(props);
    this.schedulerInvokeRole = this.buildSchedulerInvokeRole(props.config.prefix);

    new CfnOutput(this, 'RunnerFunctionArn', { value: this.runnerFunction.functionArn });
    new CfnOutput(this, 'LifecycleFunctionArn', { value: this.lifecycleFunction.functionArn });
    new CfnOutput(this, 'ScheduleGroupName', { value: groupName });
    new CfnOutput(this, 'SchedulerInvokeRoleArn', { value: this.schedulerInvokeRole.roleArn });
  }

  private logGroupFor(name: string, config: EnvConfig): LogGroup {
    return new LogGroup(this, `${name}Logs`, {
      logGroupName: `/aws/lambda/${config.prefix}-${name.toLowerCase()}`,
      retention: toRetention(config.logRetentionDays),
      removalPolicy: config.retainOnDelete ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
  }

  /** Sandbox launcher config for the (schedule-driven) runner Lambda. */
  private sandboxEnv(props: RunnerStackProps): Record<string, string> {
    const { config, sandbox } = props;
    return {
      AV_SANDBOX_CLUSTER_ARN: sandbox.cluster.clusterArn,
      AV_SANDBOX_TASKDEF_ARN: sandbox.taskDefinition.taskDefinitionArn,
      AV_SANDBOX_TASK_ROLE_ARN: sandbox.taskRole.roleArn,
      AV_SANDBOX_SUBNET_IDS: sandbox.subnetIds.join(','),
      AV_SANDBOX_SECURITY_GROUP: sandbox.securityGroup.securityGroupId,
      AV_WORKSPACE_BUCKET: sandbox.workspaceBucket.bucketName,
      AV_SANDBOX_CPU: String(config.sandboxTaskCpu),
      AV_SANDBOX_MEMORY: String(config.sandboxTaskMemoryMb),
    };
  }

  private buildRunnerFunction(props: RunnerStackProps): NodejsFunction {
    const { config, table } = props;
    const fn = new NodejsFunction(this, 'RunnerFunction', {
      functionName: `${config.prefix}-runner`,
      entry: RUNNER_ENTRY,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: config.runnerMemoryMb,
      timeout: Duration.seconds(60),
      logGroup: this.logGroupFor('Runner', config),
      environment: {
        AV_ENV: config.env,
        AV_TABLE_NAME: table.tableName,
        AV_REGION: config.region,
        ...this.sandboxEnv(props),
      },
      bundling: BUNDLING,
    });
    table.grantReadWriteData(fn);
    this.grantSecretRead(fn, config);
    this.grantSandboxLaunch(fn, props);
    return fn;
  }

  private buildLifecycleFunction(props: RunnerStackProps): NodejsFunction {
    const { config, table } = props;
    const fn = new NodejsFunction(this, 'LifecycleFunction', {
      functionName: `${config.prefix}-lifecycle`,
      entry: LIFECYCLE_ENTRY,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: config.runnerMemoryMb,
      timeout: Duration.seconds(60),
      logGroup: this.logGroupFor('Lifecycle', config),
      environment: { AV_ENV: config.env, AV_TABLE_NAME: table.tableName, AV_REGION: config.region },
      bundling: BUNDLING,
    });
    table.grantReadWriteData(fn);
    return fn;
  }

  private buildTaskStoppedRule(props: RunnerStackProps): void {
    new Rule(this, 'SandboxTaskStopped', {
      ruleName: `${props.config.prefix}-sandbox-task-stopped`,
      eventPattern: {
        source: ['aws.ecs'],
        detailType: ['ECS Task State Change'],
        detail: { clusterArn: [props.sandbox.cluster.clusterArn], lastStatus: ['STOPPED'] },
      },
      targets: [new LambdaFunction(this.lifecycleFunction)],
    });
  }

  private grantSecretRead(fn: NodejsFunction, config: EnvConfig): void {
    fn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${config.region}:*:secret:agent-village/${config.env}/agents/*/anthropic-key-*`,
        ],
      }),
    );
  }

  private grantSandboxLaunch(fn: NodejsFunction, props: RunnerStackProps): void {
    const { config, sandbox } = props;
    fn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ecs:RunTask'],
        // Account-wildcarded so the cdk-nag suppression is deterministic when
        // synthesizing without credentials; the family name is the real scope.
        resources: [`arn:aws:ecs:${config.region}:*:task-definition/${config.prefix}-sandbox:*`],
      }),
    );
    fn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['iam:PassRole'],
        resources: [sandbox.taskRole.roleArn, sandbox.executionRole.roleArn],
        conditions: { StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' } },
      }),
    );
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
