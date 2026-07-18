import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
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
import type { Queue } from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../../config/index.js';
import { toRetention } from './log-retention.js';
import {
  buildDlq,
  buildWatchdogStopTaskRole,
  grantSandboxLaunch,
  grantSecretRead,
  grantWatchdogArm,
  watchdogScheduleArnPattern,
} from './runner-iam.js';
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
const SWEEPER_ENTRY = path.resolve(SELF_DIR, '../../../runner/src/sweeper.ts');

/** Long non-streaming Anthropic generations are forwarded synchronously (buffered). */
const GATEWAY_TIMEOUT_MINUTES = 5;
/**
 * Slack between the gateway's in-flight upstream abort and the Lambda's own hard
 * timeout, so the reservation is settled inside the invocation instead of the
 * runtime killing us mid-await. Keep GATEWAY_TIMEOUT_MINUTES as the single knob:
 * raising it lifts both the Lambda ceiling and the upstream budget below (for
 * long apply-bot web-search generations — Lambda hard-max is 15 min).
 */
const GATEWAY_DEADLINE_BUFFER_MS = 10_000;
const GATEWAY_UPSTREAM_TIMEOUT_MS = GATEWAY_TIMEOUT_MINUTES * 60_000 - GATEWAY_DEADLINE_BUFFER_MS;

/** How often the stuck-run sweeper reconciles runs wedged in `running`. */
const SWEEPER_RATE_MINUTES = 5;
/**
 * EventBridge target retry window before a stop event that could not be
 * delivered to the lifecycle Lambda (throttling, a multi-hour finalizer
 * outage) is parked in the DLQ instead of being lost.
 */
const LIFECYCLE_TARGET_RETRY_ATTEMPTS = 10;
const LIFECYCLE_TARGET_MAX_EVENT_AGE_HOURS = 6;

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
  public readonly sweeperFunction: NodejsFunction;
  public readonly scheduleGroupName: string;
  public readonly schedulerInvokeRole: Role;
  public readonly watchdogGroupName: string;
  public readonly watchdogStopTaskRole: Role;
  /** DLQ for stop events EventBridge could not deliver to the lifecycle Lambda. */
  public readonly lifecycleDlq: Queue;
  /** DLQ for watchdog StopTask invocations that failed (e.g. ECS throttle) at fire time. */
  public readonly watchdogDlq: Queue;

  constructor(scope: Construct, id: string, props: RunnerStackProps) {
    super(scope, id, props);
    this.scheduleGroupName = this.buildScheduleGroup(
      'ScheduleGroup',
      `${props.config.prefix}-agents`,
    );
    const watchdog = this.buildWatchdogInfra(props.config);
    this.watchdogGroupName = watchdog.groupName;
    this.watchdogDlq = watchdog.dlq;
    this.watchdogStopTaskRole = watchdog.role;

    // Built before the runner: the launcher injects the gateway URL into tasks.
    this.gatewayFunction = this.buildGatewayFunction(props);
    this.gatewayFunctionUrl = this.gatewayFunction.addFunctionUrl({
      // Auth is the per-run bearer token validated in the handler (ADR 0004);
      // the URL must be publicly reachable through the sandbox egress proxy.
      authType: FunctionUrlAuthType.NONE,
    });
    this.runnerFunction = this.buildRunnerFunction(props);
    this.lifecycleFunction = this.buildLifecycleFunction(props);
    this.lifecycleDlq = buildDlq(this, 'LifecycleDlq', `${props.config.prefix}-lifecycle-dlq`);
    this.buildTaskStoppedRule(props);
    // Stuck-run sweeper: last-resort backstop that finalizes runs wedged in
    // `running` past their max lifetime (poison-pill event / finalizer outage).
    this.sweeperFunction = this.buildSweeperFunction(props);
    this.schedulerInvokeRole = this.buildSchedulerInvokeRole(props.config.prefix);
    this.buildOutputs();
  }

  /** Create a named EventBridge Scheduler group and return its name. */
  private buildScheduleGroup(id: string, name: string): string {
    new CfnScheduleGroup(this, id, { name });
    return name;
  }

  /**
   * Run-duration kill switch: per-run one-shot StopTask schedules live in their
   * own group so launcher/lifecycle IAM never touches the agent cron schedules.
   * A StopTask fire the scheduler cannot deliver (ECS throttle) is parked in the
   * DLQ instead of silently dropping the backstop.
   */
  private buildWatchdogInfra(config: EnvConfig): {
    groupName: string;
    dlq: Queue;
    role: Role;
  } {
    const groupName = this.buildScheduleGroup(
      'WatchdogScheduleGroup',
      `${config.prefix}-run-watchdogs`,
    );
    const dlq = buildDlq(this, 'WatchdogDlq', `${config.prefix}-run-watchdog-dlq`);
    const role = buildWatchdogStopTaskRole(this, config);
    dlq.grantSendMessages(role);
    return { groupName, dlq, role };
  }

  private buildOutputs(): void {
    new CfnOutput(this, 'RunnerFunctionArn', { value: this.runnerFunction.functionArn });
    new CfnOutput(this, 'LifecycleFunctionArn', { value: this.lifecycleFunction.functionArn });
    new CfnOutput(this, 'GatewayFunctionUrl', { value: this.gatewayFunctionUrl.url });
    new CfnOutput(this, 'SweeperFunctionArn', { value: this.sweeperFunction.functionArn });
    new CfnOutput(this, 'LifecycleDlqUrl', { value: this.lifecycleDlq.queueUrl });
    new CfnOutput(this, 'WatchdogDlqUrl', { value: this.watchdogDlq.queueUrl });
    new CfnOutput(this, 'ScheduleGroupName', { value: this.scheduleGroupName });
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
      AV_WATCHDOG_GROUP: this.watchdogGroupName,
      AV_WATCHDOG_ROLE_ARN: this.watchdogStopTaskRole.roleArn,
      // Failed StopTask fires are parked here instead of being silently dropped.
      AV_WATCHDOG_DLQ_ARN: this.watchdogDlq.queueArn,
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
        // Configurable upstream hard timeout (resolveUpstreamTimeoutMs); derived
        // from the Lambda timeout so the two move together.
        AV_GATEWAY_UPSTREAM_TIMEOUT_MS: String(GATEWAY_UPSTREAM_TIMEOUT_MS),
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
    grantSecretRead(fn, config);
    grantSandboxLaunch(
      fn,
      config,
      props.sandbox.taskRole.roleArn,
      props.sandbox.executionRole.roleArn,
    );
    grantWatchdogArm(fn, config, this.watchdogGroupName, this.watchdogStopTaskRole.roleArn);
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
        // Honest-cost reconciliation prices the actual task duration with the
        // same size the launcher used for the flat reservation.
        AV_SANDBOX_CPU: String(config.sandboxTaskCpu),
        AV_SANDBOX_MEMORY: String(config.sandboxTaskMemoryMb),
      },
      bundling: BUNDLING,
    });
    table.grantReadWriteData(fn);
    // Disarm the per-run kill-switch schedule once the task has stopped.
    fn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['scheduler:DeleteSchedule'],
        resources: [watchdogScheduleArnPattern(config, this.watchdogGroupName)],
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
      targets: [
        new LambdaFunction(this.lifecycleFunction, {
          // A stop event EventBridge cannot deliver (finalizer throttled/out for
          // hours) is retried, then dead-lettered — never lost. The stuck-run
          // sweeper is the second safety net for runs still wedged after that.
          deadLetterQueue: this.lifecycleDlq,
          retryAttempts: LIFECYCLE_TARGET_RETRY_ATTEMPTS,
          maxEventAge: Duration.hours(LIFECYCLE_TARGET_MAX_EVENT_AGE_HOURS),
        }),
      ],
    });
  }

  /**
   * Stuck-run sweeper Lambda: finalizes sandbox runs wedged in `running` past
   * their maximum lifetime via the same lifecycle settlement path (idempotent,
   * fail-safe). Mirrors the lifecycle Lambda's env + IAM: it reads/writes the
   * table and disarms the per-run watchdog schedule as finalization does.
   */
  private buildSweeperFunction(props: RunnerStackProps): NodejsFunction {
    const { config, table } = props;
    const fn = new NodejsFunction(this, 'SweeperFunction', {
      functionName: `${config.prefix}-sweeper`,
      entry: SWEEPER_ENTRY,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: config.runnerMemoryMb,
      timeout: Duration.seconds(60),
      logGroup: this.logGroupFor('Sweeper', config),
      environment: {
        AV_ENV: config.env,
        AV_TABLE_NAME: table.tableName,
        AV_REGION: config.region,
        AV_WATCHDOG_GROUP: this.watchdogGroupName,
        // Reconciliation prices actual duration with the launcher's task size.
        AV_SANDBOX_CPU: String(config.sandboxTaskCpu),
        AV_SANDBOX_MEMORY: String(config.sandboxTaskMemoryMb),
      },
      bundling: BUNDLING,
    });
    table.grantReadWriteData(fn);
    // Finalization disarms the per-run kill-switch schedule (best effort).
    fn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['scheduler:DeleteSchedule'],
        resources: [watchdogScheduleArnPattern(config, this.watchdogGroupName)],
      }),
    );
    new Rule(this, 'StuckRunSweep', {
      ruleName: `${config.prefix}-stuck-run-sweep`,
      schedule: Schedule.rate(Duration.minutes(SWEEPER_RATE_MINUTES)),
      targets: [new LambdaFunction(fn)],
    });
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
