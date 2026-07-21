import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { devConfig } from '../../config/dev.js';
import type { EnvConfig } from '../../config/index.js';
import { WebStack } from './web-stack.js';

/**
 * synth() always runs against a temp `webDistPathOverride` rather than the
 * real packages/web/dist on disk, so these tests are deterministic
 * regardless of whether the sibling @agent-village/web package has been
 * built locally (see M4 verification finding: coupling to on-disk dist
 * previously made `pnpm build && pnpm test` fail these tests).
 */
function synth(config: EnvConfig = devConfig, options: { withDist?: boolean } = {}): Template {
  const app = new App();
  const stack = new WebStack(app, 'test-web', {
    env: { account: '000000000000', region: 'us-east-1' },
    config,
    webDistPathOverride: options.withDist ? withDistDir() : emptyDistDir(),
  });
  return Template.fromStack(stack);
}

let tempDirs: string[] = [];

function emptyDistDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'av-web-stack-test-empty-'));
  tempDirs.push(dir);
  return dir;
}

function withDistDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'av-web-stack-test-dist-'));
  tempDirs.push(dir);
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><body>spa</body></html>');
  return dir;
}

describe('WebStack', () => {
  const originalDeployWeb = process.env['AV_DEPLOY_WEB'];

  afterEach(() => {
    if (originalDeployWeb === undefined) {
      delete process.env['AV_DEPLOY_WEB'];
    } else {
      process.env['AV_DEPLOY_WEB'] = originalDeployWeb;
    }
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  beforeEach(() => {
    delete process.env['AV_DEPLOY_WEB'];
  });

  it('synths a placeholder deployment with no AV_DEPLOY_WEB and no dist (credential-free CI synth)', () => {
    const template = synth(devConfig, { withDist: false });
    template.resourceCountIs('Custom::CDKBucketDeployment', 1);
    template.hasOutput('WebServingPlaceholder', { Value: 'true' });
  });

  it('throws the deploy guard when AV_DEPLOY_WEB=1 but packages/web/dist is absent', () => {
    process.env['AV_DEPLOY_WEB'] = '1';
    expect(() => synth(devConfig, { withDist: false })).toThrow(
      /AV_DEPLOY_WEB=1 but packages\/web\/dist\/index\.html is absent/,
    );
  });

  it('ships the real bundle and clears the placeholder flag when dist is present', () => {
    process.env['AV_DEPLOY_WEB'] = '1';
    const template = synth(devConfig, { withDist: true });
    template.resourceCountIs('Custom::CDKBucketDeployment', 1);
    template.hasOutput('WebServingPlaceholder', { Value: 'false' });
  });

  it('serves the SPA via a CloudFront distribution with an OAC S3 origin', () => {
    const template = synth();
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
        }),
      }),
    });
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
  });
});
