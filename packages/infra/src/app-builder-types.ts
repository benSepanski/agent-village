import type { DataStack } from './stacks/data-stack.js';
import type { AuthStack } from './stacks/auth-stack.js';
import type { ApiStack } from './stacks/api-stack.js';
import type { RunnerStack } from './stacks/runner-stack.js';
import type { SandboxStack } from './stacks/sandbox-stack.js';
import type { WebStack } from './stacks/web-stack.js';
import type { MonitoringStack } from './stacks/monitoring-stack.js';

/** Every stack buildApp constructs for one environment. Shared between
 * app-builder.ts (construction/tagging) and app-builder-suppressions.ts
 * (cdk-nag suppressions) so both operate on the same typed handles. */
export interface Stacks {
  readonly data: DataStack;
  readonly auth: AuthStack;
  readonly sandbox: SandboxStack;
  readonly runner: RunnerStack;
  readonly api: ApiStack;
  readonly web: WebStack;
  readonly monitoring: MonitoringStack;
}
