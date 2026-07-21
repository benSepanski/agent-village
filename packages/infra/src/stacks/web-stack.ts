import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Annotations, CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  CachePolicy,
  Distribution,
  PriceClass,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source, type ISource } from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../../config/index.js';

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(SELF_DIR, '../../../web/dist');
const PLACEHOLDER_INDEX =
  '<!doctype html><html><body><h1>agent-village</h1><p>SPA bundle has not been built yet. Run `pnpm --filter @agent-village/web build` and redeploy.</p></body></html>';

export interface WebStackProps extends StackProps {
  readonly config: EnvConfig;
  /**
   * Overrides the resolved packages/web/dist path. Test-only escape hatch so
   * placeholder-vs-real-bundle behavior can be exercised against a
   * controlled temp directory instead of depending on whether the sibling
   * @agent-village/web package happens to have been built on disk.
   */
  readonly webDistPathOverride?: string;
}

/**
 * Resolves the SPA bundle source and enforces the deploy-time guard: a real
 * deploy (AV_DEPLOY_WEB=1) must ship the real bundle rather than silently
 * pruning the bucket down to the placeholder page. Returns the BucketDeployment
 * sources plus whether the placeholder is being served (surfaced as the
 * WebServingPlaceholder output for the deploy-verify step and the playbook).
 *
 * AV_WEB_FORCE_PLACEHOLDER=1 is a test-only escape hatch that pins
 * placeholder mode regardless of whether packages/web/dist happens to exist
 * on disk. It exists so the synth-snapshot zero-drift test (test/synth-
 * snapshot.test.ts) is deterministic in both CI (no web build) and local dev
 * (web build present) — see test/synth-baseline.ts. It does not weaken the
 * AV_DEPLOY_WEB=1 production guard below: forcing placeholder mode still
 * makes distPresent false, so a real deploy that also (incorrectly) set both
 * vars would still hit the same "must build the SPA first" failure.
 */
function resolveWebSource(
  stack: Stack,
  webDistPath: string = WEB_DIST,
): { sources: ISource[]; isPlaceholder: boolean } {
  const deployWeb = process.env['AV_DEPLOY_WEB'] === '1';
  const forcePlaceholder = process.env['AV_WEB_FORCE_PLACEHOLDER'] === '1';
  const distPresent = !forcePlaceholder && existsSync(path.join(webDistPath, 'index.html'));

  if (deployWeb && !distPresent) {
    throw new Error(
      'AV_DEPLOY_WEB=1 but packages/web/dist/index.html is absent. Build the SPA ' +
        '(pnpm --filter @agent-village/web build) before cdk deploy.',
    );
  }

  if (!distPresent) {
    Annotations.of(stack).addWarning(
      'WebStack is shipping PLACEHOLDER_INDEX — no packages/web/dist build present. ' +
        'Expected during credential-free synth; a real deploy MUST set AV_DEPLOY_WEB=1.',
    );
  }

  const sources = distPresent
    ? [Source.asset(webDistPath)]
    : [Source.data('index.html', PLACEHOLDER_INDEX)];
  return { sources, isPlaceholder: !distPresent };
}

export class WebStack extends Stack {
  public readonly bucket: Bucket;
  public readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);
    const { config } = props;
    const removal = config.retainOnDelete ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    this.bucket = new Bucket(this, 'WebBucket', {
      bucketName: `${config.prefix}-web`,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: config.env === 'prod',
      removalPolicy: removal,
      autoDeleteObjects: !config.retainOnDelete,
    });

    this.distribution = new Distribution(this, 'WebDistribution', {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      priceClass: PriceClass.PRICE_CLASS_100,
      errorResponses: [
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    const { sources, isPlaceholder } = resolveWebSource(this, props.webDistPathOverride);

    new BucketDeployment(this, 'WebDeployment', {
      sources,
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      prune: true,
    });

    new CfnOutput(this, 'WebUrl', { value: `https://${this.distribution.distributionDomainName}` });
    new CfnOutput(this, 'WebBucketName', { value: this.bucket.bucketName });
    new CfnOutput(this, 'WebServingPlaceholder', { value: String(isPlaceholder) });
  }
}
