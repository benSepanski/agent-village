import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { beforeAll, describe, it } from 'vitest';
import { devConfig } from '../../config/dev.js';
import { ApiStack } from './api-stack.js';
import { AuthStack } from './auth-stack.js';
import { DataStack } from './data-stack.js';
import { SandboxStack } from './sandbox-stack.js';

let template: Template;

beforeAll(() => {
  const app = new App();
  const env = { account: '000000000000', region: 'us-east-1' };
  const data = new DataStack(app, 'test-data', { env, config: devConfig });
  const auth = new AuthStack(app, 'test-auth', { env, config: devConfig });
  const sandbox = new SandboxStack(app, 'test-sandbox', { env, config: devConfig });

  // Lightweight stand-ins for the runner-stack outputs ApiStack needs — a
  // real RunnerStack bundles four ~600kb Lambdas via esbuild, which is slow
  // and irrelevant to what this test asserts about ApiStack's own routes
  // and grants.
  const deps = new Stack(app, 'test-deps', { env });
  const runnerFunction = new LambdaFunction(deps, 'StubRunnerFn', {
    runtime: Runtime.NODEJS_22_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => {};'),
  });
  const schedulerInvokeRole = new Role(deps, 'StubSchedulerRole', {
    assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
  });

  const api = new ApiStack(app, 'test-api', {
    env,
    config: devConfig,
    table: data.table,
    userPool: auth.userPool,
    userPoolClient: auth.userPoolClient,
    runnerFunction,
    scheduleGroupName: 'test-schedule-group',
    schedulerInvokeRole,
    workspaceBucket: sandbox.workspaceBucket,
  });
  template = Template.fromStack(api);
}, 30_000);

describe('ApiStack workspace routes', () => {
  it('registers GET /agents/{id}/workspace and POST /agents/{id}/workspace/presign', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /agents/{id}/workspace',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'POST /agents/{id}/workspace/presign',
    });
  });

  it('injects AV_WORKSPACE_BUCKET into both workspace Lambdas', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'agent-village-dev-api-agents-workspace-list',
      Environment: { Variables: Match.objectLike({ AV_WORKSPACE_BUCKET: Match.anyValue() }) },
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'agent-village-dev-api-agents-workspace-presign',
      Environment: { Variables: Match.objectLike({ AV_WORKSPACE_BUCKET: Match.anyValue() }) },
    });
  });

  it('grants the list handler s3:ListBucket only (no object-level actions)', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyName: Match.stringLikeRegexp('agentsworkspacelistFnServiceRoleDefaultPolicy'),
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Effect: 'Allow', Action: 's3:ListBucket' }),
        ]),
      }),
    });
  });

  it('grants the presign handler get/put/delete scoped to bucket objects', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyName: Match.stringLikeRegexp('agentsworkspacepresignFnServiceRoleDefaultPolicy'),
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
          }),
        ]),
      }),
    });
  });

  it('does not grant the presign handler agent-secrets Secrets Manager CRUD (perms: read, not write)', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyName: Match.stringLikeRegexp('agentsworkspacepresignFnServiceRoleDefaultPolicy'),
      PolicyDocument: Match.objectLike({
        Statement: Match.not(
          Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([Match.stringLikeRegexp('^secretsmanager:')]),
            }),
          ]),
        ),
      }),
    });
  });
});
