import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  CachePolicy,
  Distribution,
  PriceClass,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../../config/index.js';

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(SELF_DIR, '../../../web/dist');
const PLACEHOLDER_INDEX =
  '<!doctype html><html><body><h1>agent-village</h1><p>SPA bundle has not been built yet. Run `pnpm --filter @agent-village/web build` and redeploy.</p></body></html>';

export interface WebStackProps extends StackProps {
  readonly config: EnvConfig;
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

    const sources = existsSync(path.join(WEB_DIST, 'index.html'))
      ? [Source.asset(WEB_DIST)]
      : [Source.data('index.html', PLACEHOLDER_INDEX)];

    new BucketDeployment(this, 'WebDeployment', {
      sources,
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      prune: true,
    });

    new CfnOutput(this, 'WebUrl', { value: `https://${this.distribution.distributionDomainName}` });
    new CfnOutput(this, 'WebBucketName', { value: this.bucket.bucketName });
  }
}
