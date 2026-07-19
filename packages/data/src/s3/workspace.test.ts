import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createS3Mock, type S3Mock } from '../../test-utils/s3-mock.js';
import { resetS3Client } from './client.js';
import { listWorkspaceObjects, presignWorkspaceUrl } from './workspace.js';

const BUCKET = 'agent-village-dev-workspace';

let mock: S3Mock;

beforeEach(() => {
  // Static local creds so getSignedUrl signs without any credential-provider
  // network lookup (IMDS, SSO, ...) — deterministic and offline.
  process.env['AV_LOCAL'] = '1';
  process.env['AWS_REGION'] = 'us-east-1';
  process.env['AV_S3_ENDPOINT'] = 'http://localhost:4566';
  resetS3Client();
  mock = createS3Mock();
  mock.reset();
});

afterEach(() => {
  mock.restore();
  delete process.env['AV_LOCAL'];
  delete process.env['AV_S3_ENDPOINT'];
});

describe('listWorkspaceObjects', () => {
  it('lists one page and reports truncation', async () => {
    mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: 'sub/a/b/notes.md', Size: 12, LastModified: new Date('2026-07-18T00:00:00.000Z') },
      ],
      IsTruncated: true,
    });
    const page = await listWorkspaceObjects(BUCKET, 'sub/a/b/');
    expect(page).toEqual({
      entries: [{ key: 'sub/a/b/notes.md', size: 12, lastModified: '2026-07-18T00:00:00.000Z' }],
      truncated: true,
    });
    const call = mock.commandCalls(ListObjectsV2Command)[0]!;
    expect(call.args[0].input).toEqual({ Bucket: BUCKET, Prefix: 'sub/a/b/', MaxKeys: 1000 });
  });

  it('skips entries missing key, size, or lastModified', async () => {
    mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: 'no-size-or-date' }],
    });
    expect(await listWorkspaceObjects(BUCKET, 'sub/')).toEqual({ entries: [], truncated: false });
  });

  it('returns an empty page when there are no contents', async () => {
    mock.on(ListObjectsV2Command).resolves({});
    expect(await listWorkspaceObjects(BUCKET, 'sub/')).toEqual({ entries: [], truncated: false });
  });
});

describe('presignWorkspaceUrl', () => {
  it('presigns a GET URL scoped to the exact key with the requested expiry', async () => {
    const url = await presignWorkspaceUrl(BUCKET, 'sub/a/notes.md', 'get', 900);
    expect(url).toContain(`${BUCKET}/sub/a/notes.md`);
    expect(url).toContain('X-Amz-Expires=900');
  });

  it('presigns PUT and DELETE URLs scoped to the exact key', async () => {
    const put = await presignWorkspaceUrl(BUCKET, 'a.txt', 'put');
    const del = await presignWorkspaceUrl(BUCKET, 'a.txt', 'delete');
    expect(put).toContain(`${BUCKET}/a.txt`);
    expect(del).toContain(`${BUCKET}/a.txt`);
  });

  it('defaults the expiry to 900 seconds', async () => {
    const url = await presignWorkspaceUrl(BUCKET, 'a.txt', 'get');
    expect(url).toContain('X-Amz-Expires=900');
  });
});
