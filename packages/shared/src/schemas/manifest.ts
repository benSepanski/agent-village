import { z } from 'zod';
import type { AgentId, UserId } from './ids.js';

const NAME_MAX = 80;
const EGRESS_MAX = 25;
const GRANTS_MAX = 10;
const RECIPIENTS_MAX = 20;
const TIMEOUT_MINUTES_MAX = 120;
const FLUSH_SECONDS_MAX = 3600;
const DEFAULT_TIMEOUT_MINUTES = 30;
const DEFAULT_FLUSH_SECONDS = 300;

const DOMAIN_REGEX = /^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}$/i;
const GITHUB_REPO_REGEX = /^[\w.-]+\/[\w.-]+$/;
const SECRET_NAME_MAX = 64;
const ENV_NAME_MAX = 64;
/** Kebab-case: lowercase alphanumeric words separated by single hyphens. */
const SECRET_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** POSIX-style env var name, uppercase by convention. */
const ENV_NAME_REGEX = /^[A-Z][A-Z0-9_]*$/;

/**
 * Env vars the platform injects into the app container (or that the base-image
 * entrypoint depends on). A `secret` grant may not shadow any of these — doing
 * so could redirect LLM traffic, replace the scoped AWS creds, or break the
 * workspace sync. Prefix families cover AV_* (platform contract),
 * ANTHROPIC_* (metering gateway) and AWS_* (scoped STS creds / SDK config).
 */
const RESERVED_ENV_PREFIXES = ['AV_', 'ANTHROPIC_', 'AWS_'] as const;
const RESERVED_ENV_NAMES: ReadonlySet<string> = new Set([
  // Injected by the richer typed grants.
  'NOTION_TOKEN',
  'GITHUB_TOKEN',
  'GITHUB_REPOS',
  // Process/runtime vars the entrypoint relies on.
  'PATH',
  'HOME',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'NODE_OPTIONS',
  // Deliberately unset (ADR 0003): would point `aws s3 sync` at the proxy.
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
]);

/** True when `name` is reserved for platform-injected sandbox env. */
export function isReservedSandboxEnv(name: string): boolean {
  return RESERVED_ENV_NAMES.has(name) || RESERVED_ENV_PREFIXES.some((p) => name.startsWith(p));
}

// Platform-managed leaves under the agent's Secrets Manager prefix. A generic
// `secret` grant naming one of these would inject the platform's own secret
// into the sandbox — `anthropic-key` in particular would hand the app the real
// Anthropic key, bypassing the metering gateway's spend cap (ADR 0004).
const RESERVED_SECRET_LEAVES: ReadonlySet<string> = new Set([
  'anthropic-key',
  'notion-token',
  'github-pat',
]);

/** True when `name` is a platform-managed secret leaf a manifest may not grant. */
export function isReservedSecretLeaf(name: string): boolean {
  return RESERVED_SECRET_LEAVES.has(name);
}

export const EgressDomain = z
  .string()
  .regex(DOMAIN_REGEX, 'must be a bare domain like api.notion.com or *.example.com');
export type EgressDomain = z.infer<typeof EgressDomain>;

export const SesGrant = z.object({
  kind: z.literal('ses'),
  fromAddress: z.string().email(),
  allowedRecipients: z.array(z.string().email()).min(1).max(RECIPIENTS_MAX),
});
export type SesGrant = z.infer<typeof SesGrant>;

export const NotionGrant = z.object({
  kind: z.literal('notion'),
  /** Secrets Manager name of the per-agent Notion integration token. */
  secretName: z.string().min(1),
});
export type NotionGrant = z.infer<typeof NotionGrant>;

export const GithubGrant = z.object({
  kind: z.literal('github'),
  /** `owner/repo` slugs this agent's fine-grained PAT is scoped to. */
  repos: z.array(z.string().regex(GITHUB_REPO_REGEX)).min(1),
  /** Secrets Manager name of the fine-grained PAT. */
  secretName: z.string().min(1),
});
export type GithubGrant = z.infer<typeof GithubGrant>;

/**
 * Generic named secret: resolves the agent's own Secrets Manager secret
 * `agent-village/<env>/agents/<agentId>/<name>` at launch and injects its
 * value as the env var `env`. Removes the need for a new grant kind per tool;
 * SES/Notion/GitHub stay as richer typed grants.
 */
export const SecretGrant = z.object({
  kind: z.literal('secret'),
  /** Secret name under the agent's own Secrets Manager prefix. */
  name: z
    .string()
    .min(1)
    .max(SECRET_NAME_MAX)
    .regex(SECRET_NAME_REGEX, 'must be kebab-case, e.g. gmail-app-password')
    .refine((name) => !isReservedSecretLeaf(name), {
      message: 'names a platform-managed secret',
    }),
  /** Env var the secret value is injected as into the run. */
  env: z
    .string()
    .min(1)
    .max(ENV_NAME_MAX)
    .regex(ENV_NAME_REGEX, 'must be an UPPER_SNAKE_CASE env var name, e.g. GMAIL_APP_PASSWORD')
    .refine((name) => !isReservedSandboxEnv(name), {
      message: 'collides with a platform-reserved env var',
    }),
});
export type SecretGrant = z.infer<typeof SecretGrant>;

export const ToolGrant = z.discriminatedUnion('kind', [
  SesGrant,
  NotionGrant,
  GithubGrant,
  SecretGrant,
]);
export type ToolGrant = z.infer<typeof ToolGrant>;

/** Two secret grants injecting the same env var would silently shadow one another. */
function rejectDuplicateSecretEnv(grants: ToolGrant[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  grants.forEach((grant, i) => {
    if (grant.kind !== 'secret') return;
    if (seen.has(grant.env)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [i, 'env'],
        message: `duplicate secret grant env var ${grant.env}`,
      });
    }
    seen.add(grant.env);
  });
}

/**
 * The contract between an application and agent-village: everything the
 * platform needs to schedule, sandbox, and restrict a containerized run.
 * The application image must be built FROM the sandbox base image so the
 * workspace-sync entrypoint wraps the run.
 */
export const ApplicationManifest = z.object({
  name: z.string().min(1).max(NAME_MAX),
  /** Image URI (built FROM the sandbox base image). */
  image: z.string().min(1),
  /** Overrides the image CMD; the base-image entrypoint always wraps it. */
  command: z.array(z.string().min(1)).min(1).optional(),
  /**
   * App-declared cron, informational only. The runner schedule is driven by the
   * agent's own top-level `schedule` (see services/agent.ts syncSchedule); this
   * field is not automatically applied to EventBridge. Set the agent schedule
   * separately to make a manifest agent run.
   */
  schedule: z.string().min(1).nullable(),
  timeoutMinutes: z.number().int().min(1).max(TIMEOUT_MINUTES_MAX).default(DEFAULT_TIMEOUT_MINUTES),
  /** Domains the egress proxy lets the sandbox reach. Empty = no egress. */
  egressAllow: z.array(EgressDomain).max(EGRESS_MAX).default([]),
  grants: z.array(ToolGrant).max(GRANTS_MAX).default([]).superRefine(rejectDuplicateSecretEnv),
  /** Seconds between background workspace flushes to S3; 0 disables. */
  flushIntervalSeconds: z
    .number()
    .int()
    .min(0)
    .max(FLUSH_SECONDS_MAX)
    .default(DEFAULT_FLUSH_SECONDS),
});
export type ApplicationManifest = z.infer<typeof ApplicationManifest>;

const WorkspaceKeySegment = z
  .string()
  .min(1)
  .regex(/^[^/\s]+$/, 'workspace key segments must not contain "/" or whitespace');

/**
 * S3 key prefix that isolates one agent's durable workspace. Per-run IAM
 * session policies are scoped to exactly this prefix.
 */
export function workspacePrefix(ownerSub: UserId, agentId: AgentId): string {
  return `${WorkspaceKeySegment.parse(ownerSub)}/${WorkspaceKeySegment.parse(agentId)}/`;
}
