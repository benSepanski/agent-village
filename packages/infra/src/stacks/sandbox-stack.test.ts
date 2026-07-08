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

  it('creates a separate egress-proxy image repo (ADR 0003 sidecar)', () => {
    template.hasResourceProperties('AWS::ECR::Repository', {
      RepositoryName: 'agent-village-dev-egress-proxy',
      ImageScanningConfiguration: { ScanOnPush: true },
    });
    template.resourceCountIs('AWS::ECR::Repository', 2);
  });

  it('creates a NAT-less VPC (no idle NAT gateway cost)', () => {
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
    template.resourceCountIs('AWS::EC2::VPC', 1);
  });

  it('defines an ARM64 Fargate task sized from config with the app container', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Cpu: '256',
      Memory: '512',
      RequiresCompatibilities: ['FARGATE'],
      RuntimePlatform: { CpuArchitecture: 'ARM64', OperatingSystemFamily: 'LINUX' },
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: 'app',
          Environment: Match.arrayWith([Match.objectLike({ Name: 'AV_WORKSPACE_BUCKET' })]),
        }),
      ]),
    });
  });

  it('adds the egress-proxy sidecar container with NET_ADMIN (ADR 0003)', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: 'egress-proxy',
          LinuxParameters: Match.objectLike({
            Capabilities: Match.objectLike({ Add: ['NET_ADMIN'] }),
          }),
        }),
      ]),
    });
  });

  it('does NOT grant the app container LinuxParameters/NET_ADMIN (only the proxy may touch iptables)', () => {
    // If the app container could add NET_ADMIN it could flush the egress rules.
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({ Name: 'app', LinuxParameters: Match.absent() }),
      ]),
    });
  });

  it('runs the app container as a fixed non-root uid (cannot setuid to the proxy uid)', () => {
    // A root app in the shared network namespace could setuid(1337) and bypass
    // the egress redirect that exempts the proxy uid (ADR 0003).
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([Match.objectLike({ Name: 'app', User: '10001' })]),
    });
  });

  it('gates the app on the egress-proxy being HEALTHY (no unfiltered start-order window)', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: 'app',
          DependsOn: Match.arrayWith([
            Match.objectLike({ ContainerName: 'egress-proxy', Condition: 'HEALTHY' }),
          ]),
        }),
      ]),
    });
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: 'egress-proxy',
          HealthCheck: Match.objectLike({
            Command: ['CMD-SHELL', 'test -f /tmp/av-egress-ready'],
          }),
        }),
      ]),
    });
  });

  it('gives the task role a 2h max session so injected creds outlive a long run', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      MaxSessionDuration: 7200,
    });
  });

  it('creates an egress security group for the sandbox tasks', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: Match.stringLikeRegexp('Sandbox task egress'),
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

  it('creates NO SES resources when sesSenderDomain is unset (default devConfig)', () => {
    template.resourceCountIs('AWS::SES::EmailIdentity', 0);
    const policies = template.findResources('AWS::IAM::Policy');
    expect(JSON.stringify(policies)).not.toContain('ses:SendEmail');
  });
});

describe('SandboxStack with sesSenderDomain configured', () => {
  let sesTemplate: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new SandboxStack(app, 'test-sandbox-ses', {
      env: { account: '000000000000', region: 'us-east-1' },
      config: { ...devConfig, sesSenderDomain: 'mail.example.com' },
    });
    sesTemplate = Template.fromStack(stack);
  });

  it('creates an SES EmailIdentity for the sender domain', () => {
    sesTemplate.hasResourceProperties('AWS::SES::EmailIdentity', {
      EmailIdentity: 'mail.example.com',
    });
  });

  it('adds a ses:SendEmail task-role statement scoped to the identity ARN', () => {
    const policies = sesTemplate.findResources('AWS::IAM::Policy');
    const statements = Object.values(policies).flatMap(
      (policy) =>
        (policy['Properties'] as { PolicyDocument: { Statement: unknown[] } }).PolicyDocument
          .Statement,
    );
    const sesStatements = statements.filter((statement) =>
      JSON.stringify(statement).includes('ses:SendEmail'),
    );
    expect(sesStatements.length).toBeGreaterThan(0);
    expect(JSON.stringify(sesStatements)).toContain('identity/mail.example.com');
  });
});
