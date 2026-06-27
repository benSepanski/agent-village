import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { SecurityGroup, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { Repository, TagMutability } from 'aws-cdk-lib/aws-ecr';
import {
  Cluster,
  ContainerImage,
  CpuArchitecture,
  FargateTaskDefinition,
  LogDrivers,
  OperatingSystemFamily,
} from 'aws-cdk-lib/aws-ecs';
import {
  AccountRootPrincipal,
  CompositePrincipal,
  type IRole,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
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
 * S3 bucket holding per-(user, agent) workspaces, an ECR repo for the
 * sandbox base image, and a NAT-less VPC + Fargate cluster the launcher
 * starts per-run tasks in. Everything here is ~$0 when no run is active.
 */
export class SandboxStack extends Stack {
  public readonly workspaceBucket: Bucket;
  public readonly baseImageRepository: Repository;
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

    const vpc = this.buildVpc();
    this.subnetIds = vpc.publicSubnets.map((subnet) => subnet.subnetId);
    this.securityGroup = new SecurityGroup(this, 'SandboxSecurityGroup', {
      vpc,
      allowAllOutbound: true,
      description:
        'Sandbox task egress (domain allowlisting via the egress proxy lands in step 07)',
    });
    this.cluster = new Cluster(this, 'SandboxCluster', {
      vpc,
      clusterName: `${config.prefix}-sandbox`,
    });
    this.taskRole = this.buildTaskRole();
    this.taskDefinition = this.buildTaskDefinition(config);
    this.executionRole = this.taskDefinition.obtainExecutionRole();

    new CfnOutput(this, 'WorkspaceBucketName', { value: this.workspaceBucket.bucketName });
    new CfnOutput(this, 'BaseImageRepositoryUri', {
      value: this.baseImageRepository.repositoryUri,
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
    taskDefinition.addContainer('app', {
      containerName: 'app',
      image: ContainerImage.fromEcrRepository(this.baseImageRepository, 'latest'),
      logging: LogDrivers.awsLogs({ logGroup, streamPrefix: 'sandbox' }),
      environment: {
        AV_ENV: config.env,
        AV_REGION: config.region,
        AV_WORKSPACE_BUCKET: this.workspaceBucket.bucketName,
      },
    });
    // Task-role ceiling: bucket-wide read/write. The launcher narrows each run
    // to its own workspacePrefix via an STS session policy.
    this.workspaceBucket.grantReadWrite(this.taskRole);
    return taskDefinition;
  }
}
