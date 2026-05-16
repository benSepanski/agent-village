import { Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../../config/index.js';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';

export interface RunnerStackProps extends StackProps {
  readonly config: EnvConfig;
  readonly table: Table;
}

/**
 * Placeholder — scheduled Lambda + EventBridge Scheduler group land in Phase 1.
 */
export class RunnerStack extends Stack {
  constructor(scope: Construct, id: string, props: RunnerStackProps) {
    super(scope, id, props);
    void props;
  }
}
