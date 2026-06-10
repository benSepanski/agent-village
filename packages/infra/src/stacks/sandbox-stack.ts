import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { Repository, TagMutability } from 'aws-cdk-lib/aws-ecr';
import {
  Cluster,
  ContainerImage,
  CpuArchitecture,
  FargateTaskDefinition,
  LogDrivers,
  OperatingSystemFamily,
} from 'aws-cdk-lib/aws-ecs';
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

  /** Fixed AZs so synth never performs an AWS context lookup (CI has no credentials). */
  public override get availabilityZones(): string[] {
    return [`${this.region}a`, `${this.region}b`];
  }

  constructor(scope: Construct, id: string, props: SandboxStackProps) {
    super(scope, id, props);
    const { config } = props;
    this.workspaceBucket = this.buildWorkspaceBucket(config);
    this.baseImageRepository = this.buildImageRepository(config);
    this.cluster = this.buildCluster(config);
    this.taskDefinition = this.buildTaskDefinition(config);

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

  private buildCluster(config: EnvConfig): Cluster {
    // Public subnets + no NAT gateway: NAT costs ~$32/mo idle, while per-run
    // public IPs are free-tier-scale. Egress restriction is enforced by the
    // proxy + security groups (phase 2), not by private networking.
    const vpc = new Vpc(this, 'SandboxVpc', {
      availabilityZones: this.availabilityZones,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: SubnetType.PUBLIC }],
    });
    return new Cluster(this, 'SandboxCluster', {
      vpc,
      clusterName: `${config.prefix}-sandbox`,
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
    // Task-role ceiling: bucket-wide read/write. The launcher (phase 2) narrows
    // each run to its own workspacePrefix via an STS session policy.
    this.workspaceBucket.grantReadWrite(taskDefinition.taskRole);
    return taskDefinition;
  }
}
