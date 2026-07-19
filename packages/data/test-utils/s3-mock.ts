import { S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';

export function createS3Mock() {
  return mockClient(S3Client);
}

export type S3Mock = ReturnType<typeof createS3Mock>;
