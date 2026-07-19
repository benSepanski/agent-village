import { z } from 'zod';

const WORKSPACE_PATH_MAX = 512;
const PRESIGN_FILES_MIN = 1;
const PRESIGN_FILES_MAX = 100;

/** A path segment must not itself be `.` or `..` — traversal stays unrepresentable. */
const TRAVERSAL_SEGMENTS = new Set(['.', '..']);
const PATH_SEGMENT_REGEX = /^[A-Za-z0-9._-]+$/;

function validateSegments(path: string, ctx: z.RefinementCtx): void {
  const segments = path.split('/');
  for (const segment of segments) {
    if (segment.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'path segments must not be empty' });
      return;
    }
    if (TRAVERSAL_SEGMENTS.has(segment)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'path segments must not be "." or ".."',
      });
      return;
    }
    if (!PATH_SEGMENT_REGEX.test(segment)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'path segments must match [A-Za-z0-9._-]+',
      });
      return;
    }
  }
}

/**
 * A relative workspace path, scoped under `<ownerSub>/<agentId>/` by the
 * service layer. Traversal (`.`, `..`, empty segments, non-printable chars)
 * is unrepresentable so a caller can never address outside its own prefix.
 */
export const WorkspacePath = z
  .string()
  .min(1)
  .max(WORKSPACE_PATH_MAX)
  .superRefine(validateSegments);
export type WorkspacePath = z.infer<typeof WorkspacePath>;

export const WorkspaceEntry = z.object({
  path: WorkspacePath,
  size: z.number().int().nonnegative(),
  lastModified: z.string().datetime(),
});
export type WorkspaceEntry = z.infer<typeof WorkspaceEntry>;

/** One page of a workspace listing (a single ListObjectsV2 page, MaxKeys 1000). */
export const ListWorkspaceResponse = z.object({
  entries: z.array(WorkspaceEntry),
  truncated: z.boolean(),
});
export type ListWorkspaceResponse = z.infer<typeof ListWorkspaceResponse>;

export const WorkspaceOp = z.enum(['get', 'put', 'delete']);
export type WorkspaceOp = z.infer<typeof WorkspaceOp>;

const PresignWorkspaceFile = z.object({
  path: WorkspacePath,
  op: WorkspaceOp,
});

/** Two entries requesting the same (path, op) pair would presign a duplicate URL. */
function rejectDuplicateFileOps(
  files: z.infer<typeof PresignWorkspaceFile>[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  files.forEach((file, i) => {
    const key = `${file.op}:${file.path}`;
    if (seen.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [i],
        message: `duplicate (path, op) pair: ${file.path} ${file.op}`,
      });
    }
    seen.add(key);
  });
}

export const PresignWorkspaceInput = z.object({
  files: z
    .array(PresignWorkspaceFile)
    .min(PRESIGN_FILES_MIN)
    .max(PRESIGN_FILES_MAX)
    .superRefine(rejectDuplicateFileOps),
});
export type PresignWorkspaceInput = z.infer<typeof PresignWorkspaceInput>;

export const PresignedWorkspaceUrl = z.object({
  path: WorkspacePath,
  op: WorkspaceOp,
  url: z.string().min(1),
  expiresAt: z.string().datetime(),
});
export type PresignedWorkspaceUrl = z.infer<typeof PresignedWorkspaceUrl>;

export const PresignWorkspaceResponse = z.object({
  urls: z.array(PresignedWorkspaceUrl),
});
export type PresignWorkspaceResponse = z.infer<typeof PresignWorkspaceResponse>;
