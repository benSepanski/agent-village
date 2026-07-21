import { Aspects, Tags } from 'aws-cdk-lib';
import type { App, Stack } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import type { EnvConfig } from '../config/index.js';
import { DataStack } from './stacks/data-stack.js';
import { AuthStack } from './stacks/auth-stack.js';
import { ApiStack } from './stacks/api-stack.js';
import { RunnerStack } from './stacks/runner-stack.js';
import { SandboxStack } from './stacks/sandbox-stack.js';
import { WebStack } from './stacks/web-stack.js';
import { MonitoringStack } from './stacks/monitoring-stack.js';
import type { Stacks } from './app-builder-types.js';
import { addAllSuppressions } from './app-builder-suppressions.js';

function buildStacks(app: App, config: EnvConfig): Stacks {
  const stackEnv = { account: config.account, region: config.region };

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
    budgetDriftFunction: runner.budgetDriftFunction,
    lifecycleDlq: runner.lifecycleDlq,
    watchdogDlq: runner.watchdogDlq,
  });

  return { data, auth, sandbox, runner, api, web, monitoring };
}

function tagStacks(stacks: Stacks, config: EnvConfig): void {
  for (const stack of Object.values(stacks) as Stack[]) {
    Tags.of(stack).add('Project', 'agent-village');
    Tags.of(stack).add('Env', config.env);
  }
}

/**
 * Builds every stack for one environment (dev, prod, or an injected
 * dependent-repo config) onto `app`. Extracted from bin/app.ts so both the
 * CLI shim and the synth-snapshot test (test/synth-snapshot.test.ts) can
 * invoke the exact same wiring. Moving this into a function does not change
 * the construct tree — logical IDs derive from stack-id + construct-path,
 * not from call-site — so templates are byte-identical to the pre-refactor
 * inline version in bin/app.ts.
 */
export function buildApp(app: App, config: EnvConfig): void {
  const stacks = buildStacks(app, config);

  // The runner Lambda assumes the sandbox task role (with a per-run session policy)
  // to mint workspace-prefix-scoped credentials. Wired at the app level so the
  // trust edge doesn't create a runner<->sandbox stack dependency cycle.
  stacks.sandbox.taskRole.grantAssumeRole(stacks.runner.runnerFunction.grantPrincipal);

  tagStacks(stacks, config);
  Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
  // Suppressions for things we accept in this project (each one documented).
  addAllSuppressions(stacks, config);
}
