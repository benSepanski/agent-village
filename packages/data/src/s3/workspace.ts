import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { WorkspaceOp } from '@agent-village/shared';
import { getS3Client } from './client.js';

const LIST_MAX_KEYS = 1000;
export const DEFAULT_PRESIGN_EXPIRES_SECONDS = 900;

export interface WorkspaceObject {
  key: string;
  size: number;
  lastModified: string;
}

export interface WorkspaceListPage {
  entries: WorkspaceObject[];
  truncated: boolean;
}

/** One ListObjectsV2 page (MaxKeys 1000) under `prefix` — callers strip the prefix. */
export async function listWorkspaceObjects(
  bucket: string,
  prefix: string,
): Promise<WorkspaceListPage> {
  const res = await getS3Client().send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: LIST_MAX_KEYS }),
  );
  const entries = (res.Contents ?? []).flatMap((obj) => {
    if (!obj.Key || obj.Size === undefined || !obj.LastModified) return [];
    return [{ key: obj.Key, size: obj.Size, lastModified: obj.LastModified.toISOString() }];
  });
  return { entries, truncated: res.IsTruncated ?? false };
}

function buildCommand(bucket: string, key: string, op: WorkspaceOp) {
  if (op === 'get') return new GetObjectCommand({ Bucket: bucket, Key: key });
  if (op === 'put') return new PutObjectCommand({ Bucket: bucket, Key: key });
  return new DeleteObjectCommand({ Bucket: bucket, Key: key });
}

/** Presign one GET/PUT/DELETE URL for `key`, expiring `expiresSeconds` from now. */
export function presignWorkspaceUrl(
  bucket: string,
  key: string,
  op: WorkspaceOp,
  expiresSeconds: number = DEFAULT_PRESIGN_EXPIRES_SECONDS,
): Promise<string> {
  return getSignedUrl(getS3Client(), buildCommand(bucket, key, op), {
    expiresIn: expiresSeconds,
  });
}
