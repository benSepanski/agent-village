import type { StackProps } from 'aws-cdk-lib';
import type { HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import type { IUserPool, IUserPoolClient } from 'aws-cdk-lib/aws-cognito';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import type { Role } from 'aws-cdk-lib/aws-iam';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import type { IBucket } from 'aws-cdk-lib/aws-s3';
import type { EnvConfig } from '../../config/index.js';

/** Shared between api-stack.ts (route/handler wiring) and api-stack-grants.ts
 * (IAM/env grants) so neither has to import the other's implementation. */

export interface ApiStackProps extends StackProps {
  readonly config: EnvConfig;
  readonly table: Table;
  readonly userPool: IUserPool;
  readonly userPoolClient: IUserPoolClient;
  readonly runnerFunction: IFunction;
  readonly scheduleGroupName: string;
  readonly schedulerInvokeRole: Role;
  readonly workspaceBucket: IBucket;
}

export interface HandlerSpec {
  name: string;
  method: HttpMethod;
  routePath: string;
  perms: 'read' | 'write';
  needsScheduler?: boolean;
}
