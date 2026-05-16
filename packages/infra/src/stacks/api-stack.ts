import { Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../../config/index.js';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import type { IUserPool } from 'aws-cdk-lib/aws-cognito';

export interface ApiStackProps extends StackProps {
  readonly config: EnvConfig;
  readonly table: Table;
  readonly userPool: IUserPool;
}

/**
 * Placeholder — Lambda functions, API Gateway, and JWT authorizer land in
 * Phase 1 (see docs/playbooks/add-lambda.md).
 */
export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    void props;
  }
}
