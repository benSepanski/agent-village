import type { ZodError } from '@agent-village/shared';

/** Compact, one-line-per-issue rendering — no stack trace — for local-validation failures. */
export function formatZodError(error: ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `  ${path}: ${issue.message}`;
  });
  return ['Invalid input:', ...lines].join('\n');
}
