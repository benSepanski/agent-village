#!/usr/bin/env node
import 'source-map-support/register';
import { App, Aspects, Tags } from 'aws-cdk-lib';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { loadEnvConfig } from '../config/index.js';
import { DataStack } from '../src/stacks/data-stack.js';
import { AuthStack } from '../src/stacks/auth-stack.js';
import { ApiStack } from '../src/stacks/api-stack.js';
import { RunnerStack } from '../src/stacks/runner-stack.js';
import { SandboxStack } from '../src/stacks/sandbox-stack.js';
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
// Sandbox is constructed before the runner so the runner gets its cluster/task
// references for launching and for the lifecycle EventBridge rule.
const sandbox = new SandboxStack(app, `${config.prefix}-sandbox`, { env: stackEnv, config });
const runner = new RunnerStack(app, `${config.prefix}-runner`, {
  env: stackEnv,
  config,
  table: data.table,
  sandbox,
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
  workspaceBucket: sandbox.workspaceBucket,
});
const web = new WebStack(app, `${config.prefix}-web`, { env: stackEnv, config });
const monitoring = new MonitoringStack(app, `${config.prefix}-monitoring`, {
  env: stackEnv,
  config,
  runnerFunction: runner.runnerFunction,
  lifecycleFunction: runner.lifecycleFunction,
  gatewayFunction: runner.gatewayFunction,
  sweeperFunction: runner.sweeperFunction,
  lifecycleDlq: runner.lifecycleDlq,
  watchdogDlq: runner.watchdogDlq,
});

// The runner Lambda assumes the sandbox task role (with a per-run session policy)
// to mint workspace-prefix-scoped credentials. Wired at the app level so the
// trust edge doesn't create a runner<->sandbox stack dependency cycle.
sandbox.taskRole.grantAssumeRole(runner.runnerFunction.grantPrincipal);

for (const stack of [data, auth, api, runner, sandbox, web, monitoring]) {
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
      "Per-agent secret ARNs are dynamic — granting on the agent-village/<env>/agents/*/anthropic-key prefix is the narrowest pattern available. Same logic for DDB GSI access via /index/*, EventBridge Scheduler (resource-level perms not yet supported), Lambda invoke (qualifier wildcard), and secretsmanager:ListSecrets (no resource-level scoping exists; the handlers filter on the agent name prefix in code). The workspace-presign handler resolves an app-chosen relative path into a key under the caller's own agent prefix at request time (WorkspacePath forbids traversal), so an object-level wildcard on the bucket is the narrowest static IAM grant; the presigned URL itself is scoped to the one resolved key handed back to the caller.",
    appliesTo: [
      'Resource::arn:aws:secretsmanager:us-east-1:*:secret:agent-village/dev/agents/*',
      'Resource::arn:aws:secretsmanager:us-east-1:*:secret:agent-village/dev/agents/*/anthropic-key-*',
      'Resource::arn:aws:secretsmanager:us-east-1:*:secret:agent-village/prod/agents/*',
      'Resource::arn:aws:secretsmanager:us-east-1:*:secret:agent-village/prod/agents/*/anthropic-key-*',
      'Resource::<TableCD117FA1.Arn>/index/*',
      'Resource::<RunnerFunctionB6FAF475.Arn>:*',
      'Resource::*',
      // runs-logs FilterLogEvents over the sandbox task log group: the account
      // id is wildcarded so synth stays credential-free, and `:*` is the
      // log-stream wildcard within that one group — the narrowest grant
      // CloudWatch Logs supports for FilterLogEvents.
      'Resource::arn:aws:logs:us-east-1:*:log-group:agent-village-dev-sandbox',
      'Resource::arn:aws:logs:us-east-1:*:log-group:agent-village-dev-sandbox:*',
      'Resource::arn:aws:logs:us-east-1:*:log-group:agent-village-prod-sandbox',
      'Resource::arn:aws:logs:us-east-1:*:log-group:agent-village-prod-sandbox:*',
      // Cross-stack construct reference (SandboxStack's workspace bucket) —
      // logical id is derived from the construct path relative to its own
      // stack, so it is identical for both dev and prod synths (same as the
      // <TableCD117FA1.Arn> entry above).
      'Resource::<WorkspaceBucket53E30B92.Arn>/*',
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
    id: 'AwsSolutions-SQS3',
    reason:
      'The lifecycle- and watchdog-DLQ queues are themselves dead-letter queues (the terminal sink for undeliverable stop events / failed StopTask fires), so they have no onward redrive of their own. Both are SSL-enforced (SQS4) and alarmed via the MonitoringStack.',
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
      'Per-agent secret ARNs are dynamic; DDB GSI access requires /index/* on the table ARN; scheduler invoke role is scoped to the runner Lambda only. ecs:RunTask/DescribeTaskDefinition are scoped to the single sandbox task-definition family (revision wildcard is required — RunTask cannot target a fixed revision sanely); ecs:RegisterTaskDefinition supports no resource-level scoping at all (hence Resource::*) — safety comes from iam:PassRole being pinned to the two sandbox roles, so a registered clone can only run with sandbox permissions; ecs:StopTask and the per-run watchdog schedules are per-run resources with dynamic ids, so the sandbox cluster / watchdog group is the narrowest scope; account is wildcarded only so the suppression is deterministic during credential-free synth.',
    appliesTo: [
      // ecs:RegisterTaskDefinition (per-image task-definition clones).
      'Resource::*',
      // The launcher resolves generic `secret` grants whose leaf names are
      // user-chosen, so the whole per-agent prefix is the narrowest scope;
      // reserved platform leaves are blocked in code (isReservedSecretLeaf).
      'Resource::arn:aws:secretsmanager:us-east-1:*:secret:agent-village/dev/agents/*',
      'Resource::arn:aws:secretsmanager:us-east-1:*:secret:agent-village/prod/agents/*',
      // The metering gateway reads only the per-agent Anthropic key.
      'Resource::arn:aws:secretsmanager:us-east-1:*:secret:agent-village/dev/agents/*/anthropic-key-*',
      'Resource::arn:aws:secretsmanager:us-east-1:*:secret:agent-village/prod/agents/*/anthropic-key-*',
      'Resource::<TableCD117FA1.Arn>/index/*',
      'Resource::arn:aws:ecs:us-east-1:*:task-definition/agent-village-dev-sandbox:*',
      'Resource::arn:aws:ecs:us-east-1:*:task-definition/agent-village-prod-sandbox:*',
      'Resource::arn:aws:ecs:us-east-1:*:task/agent-village-dev-sandbox/*',
      'Resource::arn:aws:ecs:us-east-1:*:task/agent-village-prod-sandbox/*',
      'Resource::arn:aws:scheduler:us-east-1:*:schedule/agent-village-dev-run-watchdogs/*',
      'Resource::arn:aws:scheduler:us-east-1:*:schedule/agent-village-prod-run-watchdogs/*',
    ],
  },
]);
NagSuppressions.addStackSuppressions(sandbox, [
  {
    id: 'AwsSolutions-S1',
    reason:
      'Workspace-bucket server access logs deferred: every object access goes through the sandbox entrypoint, which already emits structured sync events per run. Same posture as the SPA bucket.',
  },
  {
    id: 'AwsSolutions-VPC7',
    reason:
      'VPC flow logs cost per-GB ingest with no consumer yet: sandbox tasks are ephemeral and all their traffic will be forced through the egress proxy (phase 2), which is where per-agent network audit will live.',
  },
  {
    id: 'AwsSolutions-ECS4',
    reason:
      'Container Insights adds CloudWatch ingest cost; the structured-log envelope from the sandbox entrypoint already covers run observability at this scale.',
  },
  {
    id: 'AwsSolutions-ECS2',
    reason:
      'Both containers (app + egress-proxy) carry non-secret config env only (env name, region, workspace bucket name; the per-run allowlist AV_EGRESS_ALLOW is a launcher container override, not a task-def env). Secrets reach sandbox runs as short-lived STS/launcher-injected credentials, never as task-definition env vars.',
  },
  {
    id: 'AwsSolutions-VPC3',
    reason:
      'No Network ACL is attached: egress restriction is enforced intra-task by iptables in the egress-proxy sidecar (ADR 0003) which sees hostnames (SNI/Host), not by L3/L4 ACLs which cannot track CDN-fronted APIs.',
  },
  {
    id: 'AwsSolutions-IAM5',
    reason:
      'Task-role ceiling: grantReadWrite emits the S3 action wildcards and the workspace-bucket object-key wildcard (Resource::<bucket>/*) — this is the intended ceiling; each run is narrowed to its own user/agent prefix by an STS session policy from the launcher (phase 2). The Resource::* is ecr:GetAuthorizationToken on the ECS task execution role, which AWS does not allow to be resource-scoped. When sesSenderDomain is configured, ses:SendEmail/ses:SendRawEmail are granted on the exact SES identity ARN (account wildcarded only so credential-free synth is deterministic); each run is further narrowed to a fromAddress + recipient allowlist by the STS session policy.',
    appliesTo: [
      'Action::s3:GetObject*',
      'Action::s3:GetBucket*',
      'Action::s3:List*',
      'Action::s3:DeleteObject*',
      'Action::s3:Abort*',
      'Resource::<WorkspaceBucket53E30B92.Arn>/*',
      'Resource::*',
    ],
  },
  {
    id: 'AwsSolutions-IAM4',
    reason:
      'The S3 auto-delete custom-resource handler (dev-only, bucket is RETAIN in prod) uses the CDK-managed AWSLambdaBasicExecutionRole.',
  },
  {
    id: 'AwsSolutions-L1',
    reason:
      'The S3 auto-delete custom-resource handler runtime is chosen by CDK internally; we cannot override it.',
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
      'CDK BucketDeployment helper Lambda: grantRead on the CDK assets/staging bucket and grantReadWrite on the destination web bucket emit the S3 action wildcards plus the two object-key wildcards (staging <bucket>/* and WebBucket <bucket>/*). The Resource::* is cloudfront:GetInvalidation/CreateInvalidation (CloudFront invalidation has no resource-level permissions), added because the deployment invalidates the distribution. CDK-internal helper; none of these can be narrowed from outside the construct.',
    appliesTo: [
      'Action::s3:GetObject*',
      'Action::s3:GetBucket*',
      'Action::s3:List*',
      'Action::s3:DeleteObject*',
      'Action::s3:Abort*',
      'Resource::<WebBucket12880F5B.Arn>/*',
      // cdk-nag matches appliesTo against the *resolved* resource string, so once the
      // stack has a concrete account this ARN loses the <AWS::AccountId> pseudo-token.
      // Interpolate the pinned account when known; fall back to the token for
      // env-agnostic synth (no account bound to the stack).
      `Resource::arn:<AWS::Partition>:s3:::cdk-hnb659fds-assets-${config.account ?? '<AWS::AccountId>'}-us-east-1/*`,
      'Resource::*',
    ],
  },
  {
    id: 'AwsSolutions-L1',
    reason:
      'CDK BucketDeployment uses an internally-managed Lambda runtime. CDK chooses the runtime; we cannot override it.',
  },
]);

app.synth();
