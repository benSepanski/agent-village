#!/usr/bin/env node
import 'source-map-support/register';
import { App, Aspects, Tags } from 'aws-cdk-lib';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { loadEnvConfig } from '../config/index.js';
import { DataStack } from '../src/stacks/data-stack.js';
import { AuthStack } from '../src/stacks/auth-stack.js';
import { ApiStack } from '../src/stacks/api-stack.js';
import { RunnerStack } from '../src/stacks/runner-stack.js';
import { WebStack } from '../src/stacks/web-stack.js';
import { MonitoringStack } from '../src/stacks/monitoring-stack.js';

const app = new App();
const envName = app.node.tryGetContext('env') as string | undefined;
const config = loadEnvConfig(envName);

const stackEnv = {
  account: config.account,
  region: config.region,
};

const data = new DataStack(app, `${config.prefix}-data`, { env: stackEnv, config });
const auth = new AuthStack(app, `${config.prefix}-auth`, { env: stackEnv, config });
const runner = new RunnerStack(app, `${config.prefix}-runner`, {
  env: stackEnv,
  config,
  table: data.table,
});
const api = new ApiStack(app, `${config.prefix}-api`, {
  env: stackEnv,
  config,
  table: data.table,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
  runnerFunction: runner.runnerFunction,
  scheduleGroupName: runner.scheduleGroupName,
  schedulerInvokeRole: runner.schedulerInvokeRole,
});
const web = new WebStack(app, `${config.prefix}-web`, { env: stackEnv, config });
const monitoring = new MonitoringStack(app, `${config.prefix}-monitoring`, {
  env: stackEnv,
  config,
  runnerFunction: runner.runnerFunction,
});

for (const stack of [data, auth, api, runner, web, monitoring]) {
  Tags.of(stack).add('Project', 'agent-village');
  Tags.of(stack).add('Env', config.env);
}

Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

// Suppressions for things we accept in this project (each one documented).
NagSuppressions.addStackSuppressions(auth, [
  {
    id: 'AwsSolutions-COG2',
    reason:
      'MFA is optional, not required, for personal use. Revisit when multi-user/admin features land (Phase 7).',
  },
  {
    id: 'AwsSolutions-COG8',
    reason:
      'Cognito Plus tier costs per-MAU. Stay on Essentials for a personal-scale project; reconsider at >100 active users.',
  },
]);
NagSuppressions.addStackSuppressions(data, [
  {
    id: 'AwsSolutions-DDB3',
    reason:
      'PITR is enabled for prod only (see DataStack). Dev uses ephemeral data; PITR adds cost without value there.',
  },
]);
NagSuppressions.addStackSuppressions(api, [
  {
    id: 'AwsSolutions-L1',
    reason:
      'cdk-nag 2.34 has not yet been updated to recognize Node 22 as the latest Lambda runtime. We use NODEJS_22_X — re-evaluate when cdk-nag updates its allowlist.',
  },
  {
    id: 'AwsSolutions-IAM4',
    reason:
      'AWSLambdaBasicExecutionRole is the CDK default for Lambda log/X-Ray emit — replacing it with a customer-managed policy buys nothing at MVP scale.',
    appliesTo: [
      'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    ],
  },
  {
    id: 'AwsSolutions-IAM5',
    reason:
      'Per-agent secret ARNs are dynamic — granting on the agent-village/<env>/agents/*/anthropic-key prefix is the narrowest pattern available. Same logic for DDB GSI access via /index/*, EventBridge Scheduler (resource-level perms not yet supported), and Lambda invoke (qualifier wildcard).',
    appliesTo: [
      'Resource::arn:aws:secretsmanager:us-east-1:*:secret:agent-village/dev/agents/*',
      'Resource::arn:aws:secretsmanager:us-east-1:*:secret:agent-village/dev/agents/*/anthropic-key-*',
      'Resource::arn:aws:secretsmanager:us-east-1:*:secret:agent-village/prod/agents/*',
      'Resource::arn:aws:secretsmanager:us-east-1:*:secret:agent-village/prod/agents/*/anthropic-key-*',
      'Resource::<TableCD117FA1.Arn>/index/*',
      'Resource::<RunnerFunctionB6FAF475.Arn>:*',
      'Resource::*',
    ],
  },
  {
    id: 'AwsSolutions-APIG1',
    reason:
      'API Gateway access logs deferred — CloudWatch Logs from each Lambda already capture the request envelope via the structured-logging middleware. Revisit when multi-user routing lands (Phase 7).',
  },
  {
    id: 'AwsSolutions-APIG4',
    reason:
      'Every route except OPTIONS preflight is authorized via the HttpJwtAuthorizer wired to the Cognito User Pool — see ApiStack constructor.',
  },
  {
    id: 'AwsSolutions-COG4',
    reason: 'Same as APIG4 — JWT authorizer covers every route.',
  },
]);
NagSuppressions.addStackSuppressions(runner, [
  {
    id: 'AwsSolutions-L1',
    reason:
      'cdk-nag 2.34 has not yet been updated to recognize Node 22 as the latest Lambda runtime. We use NODEJS_22_X.',
  },
  {
    id: 'AwsSolutions-IAM4',
    reason: 'AWSLambdaBasicExecutionRole is the CDK default for Lambda log/X-Ray emit.',
    appliesTo: [
      'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    ],
  },
  {
    id: 'AwsSolutions-IAM5',
    reason:
      'Per-agent secret ARNs are dynamic; DDB GSI access requires /index/* on the table ARN; scheduler invoke role is scoped to the runner Lambda only.',
    appliesTo: [
      'Resource::arn:aws:secretsmanager:us-east-1:*:secret:agent-village/dev/agents/*/anthropic-key-*',
      'Resource::arn:aws:secretsmanager:us-east-1:*:secret:agent-village/prod/agents/*/anthropic-key-*',
      'Resource::<TableCD117FA1.Arn>/index/*',
    ],
  },
]);
NagSuppressions.addStackSuppressions(web, [
  {
    id: 'AwsSolutions-CFR4',
    reason:
      'Default CloudFront viewer certificate is acceptable until a custom domain is configured.',
  },
  {
    id: 'AwsSolutions-CFR3',
    reason: 'Access logging deferred to a future stack; cost-conscious MVP.',
  },
  {
    id: 'AwsSolutions-CFR1',
    reason: 'Geo restrictions not needed at MVP scale; single-user personal project.',
  },
  {
    id: 'AwsSolutions-CFR2',
    reason: 'WAF deferred until multi-user (Phase 7) — costs per-WCU.',
  },
  {
    id: 'AwsSolutions-S1',
    reason: 'S3 access logs deferred; CloudTrail covers audit needs at MVP scale.',
  },
  {
    id: 'AwsSolutions-IAM4',
    reason:
      'CDK BucketDeployment construct uses AWSLambdaBasicExecutionRole on its internal helper Lambda. This is a CDK implementation detail.',
    appliesTo: [
      'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    ],
  },
  {
    id: 'AwsSolutions-IAM5',
    reason:
      'CDK BucketDeployment helper Lambda uses wildcard S3 permissions on the staging bucket and the destination bucket. CDK-internal helper; we cannot narrow these from outside the construct.',
  },
  {
    id: 'AwsSolutions-L1',
    reason:
      'CDK BucketDeployment uses an internally-managed Lambda runtime. CDK chooses the runtime; we cannot override it.',
  },
]);

app.synth();
