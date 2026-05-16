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
const api = new ApiStack(app, `${config.prefix}-api`, {
  env: stackEnv,
  config,
  table: data.table,
  userPool: auth.userPool,
});
const runner = new RunnerStack(app, `${config.prefix}-runner`, {
  env: stackEnv,
  config,
  table: data.table,
});
const web = new WebStack(app, `${config.prefix}-web`, { env: stackEnv, config });
const monitoring = new MonitoringStack(app, `${config.prefix}-monitoring`, {
  env: stackEnv,
  config,
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
]);

app.synth();
