import { S3Client } from '@aws-sdk/client-s3';

let cached: S3Client | undefined;

function buildClient(): S3Client {
  const region = process.env['AWS_REGION'] ?? 'us-east-1';
  const local = process.env['AV_LOCAL'] === '1';
  const endpoint = local ? (process.env['AV_S3_ENDPOINT'] ?? 'http://localhost:4566') : undefined;
  return new S3Client({
    region,
    ...(endpoint
      ? {
          endpoint,
          forcePathStyle: true,
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        }
      : {}),
  });
}

export function getS3Client(): S3Client {
  cached ??= buildClient();
  return cached;
}

/** Test-only: drop the cached singleton so a fresh mock can be installed. */
export function resetS3Client(): void {
  cached = undefined;
}
