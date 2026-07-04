import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Rule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import {
  Architecture,
  type FunctionUrl,
  FunctionUrlAuthType,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';
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
const GATEWAY_ENTRY = path.resolve(SELF_DIR, '../../../runner/src/gateway.ts');

/** Long non-streaming Anthropic generations are forwarded synchronously (buffered). */
const GATEWAY_TIMEOUT_MINUTES = 5;

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
  public readonly gatewayFunction: NodejsFunction;
  public readonly gatewayFunctionUrl: FunctionUrl;
  public readonly scheduleGroupName: string;
  public readonly schedulerInvokeRole: Role;
  public readonly watchdogGroupName: string;
  public readonly watchdogStopTaskRole: Role;

  constructor(scope: Construct, id: string, props: RunnerStackProps) {
    super(scope, id, props);
    const groupName = `${props.config.prefix}-agents`;
    new CfnScheduleGroup(this, 'ScheduleGroup', { name: groupName });
    this.scheduleGroupName = groupName;

    // Run-duration kill switch: per-run one-shot schedules live in their own
    // group so launcher/lifecycle IAM never touches the agent cron schedules.
    this.watchdogGroupName = `${props.config.prefix}-run-watchdogs`;
    new CfnScheduleGroup(this, 'WatchdogScheduleGroup', { name: this.watchdogGroupName });
    this.watchdogStopTaskRole = this.buildWatchdogStopTaskRole(props.config);

    // Built before the runner: the launcher injects the gateway URL into tasks.
    this.gatewayFunction = this.buildGatewayFunction(props);
    this.gatewayFunctionUrl = this.gatewayFunction.addFunctionUrl({
      // Auth is the per-run bearer token validated in the handler (ADR 0004);
      // the URL must be publicly reachable through the sandbox egress proxy.
      authType: FunctionUrlAuthType.NONE,
    });
    this.runnerFunction = this.buildRunnerFunction(props);
    this.lifecycleFunction = this.buildLifecycleFunction(props);
    this.buildTaskStoppedRule(props);
    this.schedulerInvokeRole = this.buildSchedulerInvokeRole(props.config.prefix);
    this.buildOutputs(groupName);
  }

  private buildOutputs(groupName: string): void {
    new CfnOutput(this, 'RunnerFunctionArn', { value: this.runnerFunction.functionArn });
    new CfnOutput(this, 'LifecycleFunctionArn', { value: this.lifecycleFunction.functionArn });
    new CfnOutput(this, 'GatewayFunctionUrl', { value: this.gatewayFunctionUrl.url });
    new CfnOutput(this, 'ScheduleGroupName', { value: groupName });
    new CfnOutput(this, 'SchedulerInvokeRoleArn', { value: this.schedulerInvokeRole.roleArn });
  }

  /** ECS task ARNs in the sandbox cluster; account-wildcarded for credential-free synth. */
  private sandboxTaskArnPattern(config: EnvConfig): string {
    return `arn:aws:ecs:${config.region}:*:task/${config.prefix}-sandbox/*`;
  }

  /** Watchdog schedule ARNs; account-wildcarded for credential-free synth. */
  private watchdogScheduleArnPattern(config: EnvConfig): string {
    return `arn:aws:scheduler:${config.region}:*:schedule/${this.watchdogGroupName}/*`;
  }

  /** Role EventBridge Scheduler assumes to fire the per-run `ecs:StopTask` watchdog. */
  private buildWatchdogStopTaskRole(config: EnvConfig): Role {
    const role = new Role(this, 'WatchdogStopTaskRole', {
      roleName: `${config.prefix}-run-watchdog`,
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
    });
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ecs:StopTask'],
        resources: [this.sandboxTaskArnPattern(config)],
      }),
    );
    return role;
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
      AV_WATCHDOG_GROUP: this.watchdogGroupName,
      AV_WATCHDOG_ROLE_ARN: this.watchdogStopTaskRole.roleArn,
      // Metered Anthropic access (ADR 0004): the launcher points every task's
      // ANTHROPIC_BASE_URL at the gateway and allowlists its host.
      AV_GATEWAY_URL: this.gatewayFunctionUrl.url,
    };
  }

  /**
   * Anthropic metering gateway (ADR 0004): validates per-run tokens, reserves
   * against the spend ledger, forwards to api.anthropic.com with the
   * platform-held key, and reconciles from response usage.
   */
  private buildGatewayFunction(props: RunnerStackProps): NodejsFunction {
    const { config, table } = props;
    const fn = new NodejsFunction(this, 'GatewayFunction', {
      functionName: `${config.prefix}-anthropic-gateway`,
      entry: GATEWAY_ENTRY,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: config.runnerMemoryMb,
      timeout: Duration.minutes(GATEWAY_TIMEOUT_MINUTES),
      logGroup: this.logGroupFor('Gateway', config),
      environment: {
        AV_ENV: config.env,
        AV_TABLE_NAME: table.tableName,
        AV_REGION: config.region,
      },
      bundling: BUNDLING,
    });
    table.grantReadWriteData(fn);
    // Only the Anthropic key — the gateway never touches tool-grant secrets.
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
    this.grantWatchdogArm(fn, config);
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
      environment: {
        AV_ENV: config.env,
        AV_TABLE_NAME: table.tableName,
        AV_REGION: config.region,
        AV_WATCHDOG_GROUP: this.watchdogGroupName,
      },
      bundling: BUNDLING,
    });
    table.grantReadWriteData(fn);
    // Disarm the per-run kill-switch schedule once the task has stopped.
    fn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['scheduler:DeleteSchedule'],
        resources: [this.watchdogScheduleArnPattern(config)],
      }),
    );
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
    const prefix = `arn:aws:secretsmanager:${config.region}:*:secret:agent-village/${config.env}/agents`;
    fn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        // Per-agent secrets: the Anthropic key plus the tool-grant secrets
        // (Notion token, GitHub PAT). Trailing `-*` matches the random ARN
        // suffix Secrets Manager appends.
        resources: [
          `${prefix}/*/anthropic-key-*`,
          `${prefix}/*/notion-token-*`,
          `${prefix}/*/github-pat-*`,
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

  /**
   * Kill-switch arming for the launcher: create the per-run one-shot StopTask
   * schedule (DeleteSchedule is included because the schedule is created with
   * ActionAfterCompletion=DELETE), pass the scheduler-assumed StopTask role,
   * and stop the just-launched task directly when arming fails.
   */
  private grantWatchdogArm(fn: NodejsFunction, config: EnvConfig): void {
    fn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['scheduler:CreateSchedule', 'scheduler:DeleteSchedule'],
        resources: [this.watchdogScheduleArnPattern(config)],
      }),
    );
    fn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['iam:PassRole'],
        resources: [this.watchdogStopTaskRole.roleArn],
        conditions: { StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' } },
      }),
    );
    fn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ecs:StopTask'],
        resources: [this.sandboxTaskArnPattern(config)],
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
