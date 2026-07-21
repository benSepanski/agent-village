import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { CorsHttpMethod, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type { IUserPool } from 'aws-cdk-lib/aws-cognito';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import {
  grantRunNowExtras,
  grantSandboxLogsRead,
  grantSecretsCrud,
  grantSecretsList,
  grantSchedulerCrud,
  grantWorkspaceExtras,
  toRetention,
} from './api-stack-grants.js';
import type { ApiStackProps, HandlerSpec } from './api-stack-types.js';

export type { ApiStackProps } from './api-stack-types.js';

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const HANDLER_DIR = path.resolve(SELF_DIR, '../../../api/src/handlers');

const HANDLERS: HandlerSpec[] = [
  { name: 'me', method: HttpMethod.GET, routePath: '/me', perms: 'write' },
  // Per-user windowed budgets (M3): status read is read-only; set/clear the
  // live monthly cap writes the PROFILE item.
  { name: 'me-budget', method: HttpMethod.GET, routePath: '/me/budget', perms: 'read' },
  {
    name: 'me-budget-update',
    method: HttpMethod.PATCH,
    routePath: '/me/budget',
    perms: 'write',
  },
  { name: 'agents-list', method: HttpMethod.GET, routePath: '/agents', perms: 'read' },
  {
    name: 'agents-create',
    method: HttpMethod.POST,
    routePath: '/agents',
    perms: 'write',
    needsScheduler: true,
  },
  { name: 'agents-get', method: HttpMethod.GET, routePath: '/agents/{id}', perms: 'read' },
  {
    name: 'agents-update',
    method: HttpMethod.PATCH,
    routePath: '/agents/{id}',
    perms: 'write',
    needsScheduler: true,
  },
  {
    name: 'agents-delete',
    method: HttpMethod.DELETE,
    routePath: '/agents/{id}',
    perms: 'write',
    needsScheduler: true,
  },
  {
    name: 'agents-run-now',
    method: HttpMethod.POST,
    routePath: '/agents/{id}/run-now',
    perms: 'write',
  },
  { name: 'runs-list', method: HttpMethod.GET, routePath: '/agents/{id}/runs', perms: 'read' },
  // Month-to-date spend summed live from run records (Phase 3 step 06).
  { name: 'agents-spend', method: HttpMethod.GET, routePath: '/agents/{id}/spend', perms: 'read' },
  {
    name: 'runs-get',
    method: HttpMethod.GET,
    routePath: '/agents/{id}/runs/{runId}',
    perms: 'read',
  },
  // Live observability (Phase 3 step 07): paginated FilterLogEvents
  // passthrough over the sandbox log group for one run's streams.
  {
    name: 'runs-logs',
    method: HttpMethod.GET,
    routePath: '/agents/{id}/runs/{runId}/logs',
    perms: 'read',
  },
  // User-managed per-agent secrets (Phase 4 step 02). Set/delete ride the
  // grantSecretsCrud write perms; list needs the dedicated ListSecrets grant.
  {
    name: 'agents-secrets-set',
    method: HttpMethod.POST,
    routePath: '/agents/{id}/secrets',
    perms: 'write',
  },
  {
    name: 'agents-secrets-list',
    method: HttpMethod.GET,
    routePath: '/agents/{id}/secrets',
    perms: 'read',
  },
  {
    name: 'agents-secrets-delete',
    method: HttpMethod.DELETE,
    routePath: '/agents/{id}/secrets/{name}',
    perms: 'write',
  },
  // Direct S3 access to an agent's durable workspace prefix (Phase 5 step 01).
  {
    name: 'agents-workspace-list',
    method: HttpMethod.GET,
    routePath: '/agents/{id}/workspace',
    perms: 'read',
  },
  {
    name: 'agents-workspace-presign',
    method: HttpMethod.POST,
    routePath: '/agents/{id}/workspace/presign',
    // Only reads the agent record; the S3 GetObject/PutObject/DeleteObject
    // abilities it needs come from grantWorkspaceExtras below, not from the
    // agent-secrets Secrets Manager CRUD that 'write' would also grant.
    perms: 'read',
  },
];

export class ApiStack extends Stack {
  public readonly httpApi: HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const authorizer = new HttpJwtAuthorizer('JwtAuth', this.userPoolIssuer(props.userPool), {
      jwtAudience: [props.userPoolClient.userPoolClientId],
    });

    this.httpApi = new HttpApi(this, 'HttpApi', {
      apiName: `${props.config.prefix}-api`,
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PATCH,
          CorsHttpMethod.DELETE,
        ],
        allowHeaders: ['authorization', 'content-type'],
      },
    });

    for (const spec of HANDLERS) {
      const fn = this.buildHandler(spec, props);
      this.httpApi.addRoutes({
        path: spec.routePath,
        methods: [spec.method],
        integration: new HttpLambdaIntegration(`${spec.name}Integration`, fn),
        authorizer,
      });
    }

    new CfnOutput(this, 'ApiEndpoint', { value: this.httpApi.apiEndpoint });
    new CfnOutput(this, 'UserPoolId', { value: props.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: props.userPoolClient.userPoolClientId });
  }

  private userPoolIssuer(pool: IUserPool): string {
    return `https://cognito-idp.${this.region}.amazonaws.com/${pool.userPoolId}`;
  }

  private buildHandler(spec: HandlerSpec, props: ApiStackProps): NodejsFunction {
    const { config, table, runnerFunction, schedulerInvokeRole, scheduleGroupName } = props;
    const logGroup = new LogGroup(this, `${spec.name}Logs`, {
      logGroupName: `/aws/lambda/${config.prefix}-api-${spec.name}`,
      retention: toRetention(config.logRetentionDays),
      removalPolicy: config.retainOnDelete ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    const fn = new NodejsFunction(this, `${spec.name}Fn`, {
      functionName: `${config.prefix}-api-${spec.name}`,
      entry: path.join(HANDLER_DIR, `${spec.name}.ts`),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: config.apiMemoryMb,
      timeout: Duration.seconds(30),
      logGroup,
      environment: {
        AV_ENV: config.env,
        AV_TABLE_NAME: table.tableName,
        AV_REGION: config.region,
        AV_SCHEDULER_GROUP: scheduleGroupName,
        AV_RUNNER_LAMBDA_ARN: runnerFunction.functionArn,
        AV_SCHEDULER_ROLE_ARN: schedulerInvokeRole.roleArn,
        // Deterministic name from sandbox-stack.ts — no cross-stack edge needed.
        AV_SANDBOX_LOG_GROUP: `${config.prefix}-sandbox`,
      },
      bundling: {
        format: OutputFormat.ESM,
        target: 'node22',
        minify: true,
        externalModules: ['@aws-sdk/*'],
        banner:
          "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
      },
    });

    this.grantPermissions(fn, spec, props);
    return fn;
  }

  private grantPermissions(fn: NodejsFunction, spec: HandlerSpec, props: ApiStackProps): void {
    if (spec.perms === 'read') props.table.grantReadData(fn);
    else props.table.grantReadWriteData(fn);
    if (spec.perms === 'write') grantSecretsCrud(fn, props.config);
    if (spec.needsScheduler) grantSchedulerCrud(fn, props.schedulerInvokeRole);
    if (spec.name === 'agents-run-now') grantRunNowExtras(fn, props);
    if (spec.name === 'runs-logs') grantSandboxLogsRead(fn, props.config);
    if (spec.name === 'agents-secrets-list' || spec.name === 'agents-delete') {
      grantSecretsList(fn);
    }
    if (spec.name === 'agents-workspace-list' || spec.name === 'agents-workspace-presign') {
      grantWorkspaceExtras(fn, props, spec);
    }
  }
}
