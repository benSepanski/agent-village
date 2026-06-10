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

export const ToolGrant = z.discriminatedUnion('kind', [SesGrant, NotionGrant, GithubGrant]);
export type ToolGrant = z.infer<typeof ToolGrant>;

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
  schedule: z.string().min(1).nullable(),
  timeoutMinutes: z.number().int().min(1).max(TIMEOUT_MINUTES_MAX).default(DEFAULT_TIMEOUT_MINUTES),
  /** Domains the egress proxy lets the sandbox reach. Empty = no egress. */
  egressAllow: z.array(EgressDomain).max(EGRESS_MAX).default([]),
  grants: z.array(ToolGrant).max(GRANTS_MAX).default([]),
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
