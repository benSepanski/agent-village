import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { devConfig } from '../../config/dev.js';
import { SandboxStack } from './sandbox-stack.js';

let template: Template;

beforeAll(() => {
  const app = new App();
  const stack = new SandboxStack(app, 'test-sandbox', {
    env: { account: '000000000000', region: 'us-east-1' },
    config: devConfig,
  });
  template = Template.fromStack(stack);
});

describe('SandboxStack', () => {
  it('creates a versioned, private, SSE workspace bucket', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: { Status: 'Enabled' },
      PublicAccessBlockConfiguration: Match.objectLike({ BlockPublicAcls: true }),
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
    });
  });

  it('denies non-TLS access to the workspace bucket', () => {
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      }),
    });
  });

  it('creates the base-image repo with scan-on-push', () => {
    template.hasResourceProperties('AWS::ECR::Repository', {
      RepositoryName: 'agent-village-dev-sandbox-base',
      ImageScanningConfiguration: { ScanOnPush: true },
    });
  });

  it('creates a NAT-less VPC (no idle NAT gateway cost)', () => {
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
    template.resourceCountIs('AWS::EC2::VPC', 1);
  });

  it('defines an ARM64 Fargate task sized from config', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Cpu: '256',
      Memory: '512',
      RequiresCompatibilities: ['FARGATE'],
      RuntimePlatform: { CpuArchitecture: 'ARM64', OperatingSystemFamily: 'LINUX' },
      ContainerDefinitions: [
        Match.objectLike({
          Name: 'app',
          Environment: Match.arrayWith([Match.objectLike({ Name: 'AV_WORKSPACE_BUCKET' })]),
        }),
      ],
    });
  });

  it('grants the task role access to the workspace bucket only', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const statements = Object.values(policies).flatMap(
      (policy) =>
        (policy['Properties'] as { PolicyDocument: { Statement: unknown[] } }).PolicyDocument
          .Statement,
    );
    const s3Statements = statements.filter((statement) =>
      JSON.stringify(statement).includes('s3:GetObject'),
    );
    expect(s3Statements.length).toBeGreaterThan(0);
    expect(JSON.stringify(s3Statements)).toContain('WorkspaceBucket');
  });
});
