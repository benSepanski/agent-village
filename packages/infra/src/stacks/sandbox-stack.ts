import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { SecurityGroup, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { Repository, TagMutability } from 'aws-cdk-lib/aws-ecr';
import {
  Cluster,
  type ContainerDefinition,
  ContainerDependencyCondition,
  ContainerImage,
  CpuArchitecture,
  FargateTaskDefinition,
  type LogDriver,
  LogDrivers,
  Capability,
  LinuxParameters,
  OperatingSystemFamily,
} from 'aws-cdk-lib/aws-ecs';
import {
  AccountRootPrincipal,
  CompositePrincipal,
  Effect,
  type IRole,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { EmailIdentity, Identity } from 'aws-cdk-lib/aws-ses';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../../config/index.js';
import { toRetention } from './log-retention.js';

export interface SandboxStackProps extends StackProps {
  readonly config: EnvConfig;
}

const NONCURRENT_VERSION_DAYS_DEV = 30;
const NONCURRENT_VERSION_DAYS_PROD = 90;
const MAX_BASE_IMAGES = 10;
// A run may last up to manifest.timeoutMinutes (≤120 min); the launcher injects
// STS session credentials that must outlive the whole run, so the role's
// max session must be ≥ 2h (default is 1h).
const TASK_ROLE_SESSION_HOURS = 2;

/**
 * Compute + storage for sandboxed application runs (ADR 0002): a versioned
 * S3 bucket holding per-(user, agent) workspaces, ECR repos for the sandbox
 * base image and the egress-proxy sidecar image (ADR 0003), and a NAT-less
 * VPC + Fargate cluster the launcher starts per-run tasks in. Each task runs
 * two containers (app + egress-proxy). Everything here is ~$0 when no run is
 * active.
 */
export class SandboxStack extends Stack {
  public readonly workspaceBucket: Bucket;
  public readonly baseImageRepository: Repository;
  public readonly proxyImageRepository: Repository;
  public readonly cluster: Cluster;
  public readonly taskDefinition: FargateTaskDefinition;
  public readonly taskRole: Role;
  public readonly executionRole: IRole;
  public readonly securityGroup: SecurityGroup;
  public readonly subnetIds: string[];

  /** Fixed AZs so synth never performs an AWS context lookup (CI has no credentials). */
  public override get availabilityZones(): string[] {
    return [`${this.region}a`, `${this.region}b`];
  }

  constructor(scope: Construct, id: string, props: SandboxStackProps) {
    super(scope, id, props);
    const { config } = props;
    this.workspaceBucket = this.buildWorkspaceBucket(config);
    this.baseImageRepository = this.buildImageRepository(config);
    this.proxyImageRepository = this.buildProxyRepository(config);

    const vpc = this.buildVpc();
    this.subnetIds = vpc.publicSubnets.map((subnet) => subnet.subnetId);
    this.securityGroup = new SecurityGroup(this, 'SandboxSecurityGroup', {
      vpc,
      // Enforcement is intra-task iptables in the egress-proxy sidecar (ADR
      // 0003), not the SG; allowAllOutbound stays true so the proxy can reach
      // allowlisted domains, AWS base endpoints, and DNS.
      allowAllOutbound: true,
      description: 'Sandbox task egress; domain allowlisting enforced by the egress-proxy sidecar',
    });
    this.cluster = new Cluster(this, 'SandboxCluster', {
      vpc,
      clusterName: `${config.prefix}-sandbox`,
    });
    this.taskRole = this.buildTaskRole();
    this.taskDefinition = this.buildTaskDefinition(config);
    this.executionRole = this.taskDefinition.obtainExecutionRole();
    this.emitOutputs();
  }

  private emitOutputs(): void {
    new CfnOutput(this, 'WorkspaceBucketName', { value: this.workspaceBucket.bucketName });
    new CfnOutput(this, 'BaseImageRepositoryUri', {
      value: this.baseImageRepository.repositoryUri,
    });
    new CfnOutput(this, 'ProxyImageRepositoryUri', {
      value: this.proxyImageRepository.repositoryUri,
    });
    new CfnOutput(this, 'SandboxClusterArn', { value: this.cluster.clusterArn });
    new CfnOutput(this, 'SandboxTaskDefinitionArn', {
      value: this.taskDefinition.taskDefinitionArn,
    });
  }

  private buildWorkspaceBucket(config: EnvConfig): Bucket {
    const noncurrentDays =
      config.env === 'prod' ? NONCURRENT_VERSION_DAYS_PROD : NONCURRENT_VERSION_DAYS_DEV;
    return new Bucket(this, 'WorkspaceBucket', {
      versioned: true,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(noncurrentDays) }],
      removalPolicy: config.retainOnDelete ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !config.retainOnDelete,
    });
  }

  private buildImageRepository(config: EnvConfig): Repository {
    return new Repository(this, 'BaseImageRepository', {
      repositoryName: `${config.prefix}-sandbox-base`,
      imageScanOnPush: true,
      imageTagMutability: TagMutability.MUTABLE,
      lifecycleRules: [{ maxImageCount: MAX_BASE_IMAGES }],
      removalPolicy: config.retainOnDelete ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      emptyOnDelete: !config.retainOnDelete,
    });
  }

  private buildProxyRepository(config: EnvConfig): Repository {
    // The egress-proxy sidecar image (ADR 0003). Resolved at RunTask time like
    // the base image, so post-deploy push is fine.
    return new Repository(this, 'ProxyImageRepository', {
      repositoryName: `${config.prefix}-egress-proxy`,
      imageScanOnPush: true,
      imageTagMutability: TagMutability.MUTABLE,
      lifecycleRules: [{ maxImageCount: MAX_BASE_IMAGES }],
      removalPolicy: config.retainOnDelete ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      emptyOnDelete: !config.retainOnDelete,
    });
  }

  private buildVpc(): Vpc {
    // Public subnets + no NAT gateway: NAT costs ~$32/mo idle, while per-run
    // public IPs are free-tier-scale. Egress restriction is enforced by the
    // proxy + security groups (phase 2), not by private networking.
    return new Vpc(this, 'SandboxVpc', {
      availabilityZones: this.availabilityZones,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: SubnetType.PUBLIC }],
    });
  }

  private buildTaskRole(): Role {
    // Trusts ECS (to run the task) and the account root: the launcher Lambda is
    // granted sts:AssumeRole on this role at the app level, which — combined with
    // account-root trust — lets it mint prefix-scoped per-run credentials without
    // a cross-stack trust edge (which would create a stack dependency cycle).
    return new Role(this, 'SandboxTaskRole', {
      assumedBy: new CompositePrincipal(
        new ServicePrincipal('ecs-tasks.amazonaws.com'),
        new AccountRootPrincipal(),
      ),
      maxSessionDuration: Duration.hours(TASK_ROLE_SESSION_HOURS),
      description:
        'Sandbox task role; narrowed per run to one workspace prefix via STS session policy',
    });
  }

  private buildTaskDefinition(config: EnvConfig): FargateTaskDefinition {
    const logGroup = new LogGroup(this, 'SandboxLogs', {
      logGroupName: `${config.prefix}-sandbox`,
      retention: toRetention(config.logRetentionDays),
      removalPolicy: config.retainOnDelete ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    const taskDefinition = new FargateTaskDefinition(this, 'SandboxTask', {
      family: `${config.prefix}-sandbox`,
      cpu: config.sandboxTaskCpu,
      memoryLimitMiB: config.sandboxTaskMemoryMb,
      taskRole: this.taskRole,
      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.ARM64,
        operatingSystemFamily: OperatingSystemFamily.LINUX,
      },
    });
    const logging = LogDrivers.awsLogs({ logGroup, streamPrefix: 'sandbox' });
    const app = this.addAppContainer(taskDefinition, config, logging);
    const proxy = this.addProxyContainer(taskDefinition, config, logging);
    // Gate the app on the proxy being HEALTHY: the proxy's health check passes
    // only after its entrypoint has installed the iptables egress rules, so the
    // app cannot start (and egress) in the window before enforcement is up.
    app.addContainerDependencies({
      container: proxy,
      condition: ContainerDependencyCondition.HEALTHY,
    });
    // Task-role ceiling: bucket-wide read/write. The launcher narrows each run
    // to its own workspacePrefix via an STS session policy.
    this.workspaceBucket.grantReadWrite(this.taskRole);
    this.grantSesSend(config);
    return taskDefinition;
  }

  /**
   * SES sending ceiling for agent `ses` grants — only when a verified sender
   * domain is configured. Creates the EmailIdentity and adds ses:SendEmail /
   * ses:SendRawEmail to the task role scoped to that identity. Each run is then
   * narrowed by an STS session policy (fromAddress + recipients conditions) in
   * the launcher. When `sesSenderDomain` is unset this is a no-op: no SES
   * resources, no SES IAM, and `ses` grants are inert at send time.
   */
  private grantSesSend(config: EnvConfig): void {
    if (!config.sesSenderDomain) return;
    new EmailIdentity(this, 'SandboxSesIdentity', {
      identity: Identity.domain(config.sesSenderDomain),
    });
    this.taskRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: [`arn:aws:ses:${this.region}:*:identity/${config.sesSenderDomain}`],
      }),
    );
  }

  private addAppContainer(
    taskDefinition: FargateTaskDefinition,
    config: EnvConfig,
    logging: LogDriver,
  ): ContainerDefinition {
    return taskDefinition.addContainer('app', {
      containerName: 'app',
      image: ContainerImage.fromEcrRepository(this.baseImageRepository, 'latest'),
      logging,
      // Pin the app to the base image's non-root uid so a manifest image cannot
      // revert to root and setuid to the egress-proxy uid (1337) to bypass the
      // iptables egress redirect (ADR 0003). No LinuxParameters: the app must
      // never hold NET_ADMIN (only the proxy may touch iptables).
      user: '10001',
      // Max Fargate SIGTERM→SIGKILL window: when the watchdog StopTask fires,
      // the entrypoint's final `aws s3 sync` up must get a real chance to
      // finish (the default 30s can truncate it mid-flight).
      stopTimeout: Duration.seconds(120),
      environment: {
        AV_ENV: config.env,
        AV_REGION: config.region,
        AV_WORKSPACE_BUCKET: this.workspaceBucket.bucketName,
      },
    });
  }

  private addProxyContainer(
    taskDefinition: FargateTaskDefinition,
    config: EnvConfig,
    logging: LogDriver,
  ): ContainerDefinition {
    // Second container per task (ADR 0003): installs iptables NAT rules in the
    // shared task network namespace, so it needs NET_ADMIN. The per-run
    // allowlist arrives as an AV_EGRESS_ALLOW container override from the
    // launcher; AV_REGION lets the proxy expand AWS base domains.
    const linuxParameters = new LinuxParameters(this, 'ProxyLinuxParameters');
    linuxParameters.addCapabilities(Capability.NET_ADMIN);
    return taskDefinition.addContainer('egress-proxy', {
      containerName: 'egress-proxy',
      image: ContainerImage.fromEcrRepository(this.proxyImageRepository, 'latest'),
      logging,
      linuxParameters,
      environment: { AV_ENV: config.env, AV_REGION: config.region },
      // Readiness = iptables egress rules installed. The entrypoint writes the
      // marker file only after all NAT/filter rules are up (and before it drops
      // privileges), so the app's dependsOn:HEALTHY closes the start-order
      // window where the app could egress unfiltered.
      healthCheck: {
        command: ['CMD-SHELL', 'test -f /tmp/av-egress-ready'],
        interval: Duration.seconds(5),
        timeout: Duration.seconds(2),
        retries: 3,
        startPeriod: Duration.seconds(30),
      },
    });
  }
}
