import type { KeyValuePair } from '@aws-sdk/client-ecs';
import { grantSecrets } from '@agent-village/data';
import { agentSecretPrefix, assertGrantSecretOwned } from '@agent-village/domain';
import { isReservedSecretLeaf } from '@agent-village/shared';
import type { ApplicationManifest, SesGrant, ToolGrant } from '@agent-village/shared';
import { logger } from './logger.js';

/** IAM statement shape appended to the STS inline session policy. */
export interface SessionStatement {
  Sid: string;
  Effect: 'Allow';
  Action: string | string[];
  Resource: string | string[];
  Condition?: Record<string, Record<string, string | string[]>>;
}

export interface GrantContext {
  agentId: string;
  env: string;
}

function sesGrants(manifest: ApplicationManifest): SesGrant[] {
  return manifest.grants.filter((g): g is SesGrant => g.kind === 'ses');
}

/**
 * SES statements appended to the per-run STS session policy. The task role
 * ceiling (step 3) already allows ses:SendEmail; the session policy NARROWS it
 * to this grant's fromAddress and recipient allowlist. Inert when the role has
 * no SES permission (unset sesSenderDomain), which is fine.
 */
export function buildSesSessionStatements(manifest: ApplicationManifest): SessionStatement[] {
  return sesGrants(manifest).map((grant, i) => ({
    Sid: `SesSend${i}`,
    Effect: 'Allow',
    Action: ['ses:SendEmail', 'ses:SendRawEmail'],
    Resource: '*',
    Condition: {
      StringEquals: { 'ses:FromAddress': grant.fromAddress },
      'ForAllValues:StringLike': { 'ses:Recipients': grant.allowedRecipients },
    },
  }));
}

/** Convenience env for the app: the SES from-address + comma-joined recipients. */
export function buildSesEnv(manifest: ApplicationManifest): KeyValuePair[] {
  const grant = sesGrants(manifest)[0];
  if (!grant) return [];
  return [
    { name: 'AV_SES_FROM', value: grant.fromAddress },
    { name: 'AV_SES_RECIPIENTS', value: grant.allowedRecipients.join(',') },
  ];
}

/** Assert grant-secret ownership, structurally logging the denial before rethrow. */
function assertOwnedOrLog(secretName: string, ctx: GrantContext): void {
  try {
    assertGrantSecretOwned(secretName, ctx.agentId, ctx.env);
  } catch (err) {
    // secretName is a name/ARN, never the secret value — safe to log.
    logger.warn({ event: 'sandbox.run.grant_denied', agentId: ctx.agentId, secretName });
    throw err;
  }
}

async function notionEnv(grant: ToolGrant, ctx: GrantContext): Promise<KeyValuePair[]> {
  if (grant.kind !== 'notion') return [];
  assertOwnedOrLog(grant.secretName, ctx);
  const token = await grantSecrets.getNotionToken(grant.secretName);
  return [{ name: 'NOTION_TOKEN', value: token }];
}

async function githubEnv(grant: ToolGrant, ctx: GrantContext): Promise<KeyValuePair[]> {
  if (grant.kind !== 'github') return [];
  assertOwnedOrLog(grant.secretName, ctx);
  const pat = await grantSecrets.getGithubPat(grant.secretName);
  return [
    { name: 'GITHUB_TOKEN', value: pat },
    { name: 'GITHUB_REPOS', value: grant.repos.join(',') },
  ];
}

/**
 * Generic `secret` grant: the manifest names only the kebab-case leaf; the full
 * Secrets Manager name is derived under this agent's own prefix, so ownership
 * holds by construction — the assert is kept as defense in depth against any
 * future drift in how the name is built.
 */
async function secretEnv(grant: ToolGrant, ctx: GrantContext): Promise<KeyValuePair[]> {
  if (grant.kind !== 'secret') return [];
  // Re-checked at launch (not just in the manifest schema): a manifest stored
  // before a leaf became reserved must not inject platform secrets — the
  // Anthropic key in particular would bypass the metering gateway (ADR 0004).
  if (isReservedSecretLeaf(grant.name)) {
    throw new Error(`secret grant '${grant.name}' names a platform-managed secret`);
  }
  const secretName = `${agentSecretPrefix(ctx.agentId, ctx.env)}${grant.name}`;
  assertOwnedOrLog(secretName, ctx);
  const value = await grantSecrets.getAgentSecret(secretName);
  return [{ name: grant.env, value }];
}

/**
 * Resolve manifest grants into app-container env for one run. Secret-backed
 * grants (Notion, GitHub, generic secret) are fetched after an ownership
 * assert; SES needs no secret (it uses the injected STS creds) so only its
 * convenience env is added. Logs a metric of how many grants were injected.
 */
export async function resolveGrantEnv(
  manifest: ApplicationManifest,
  ctx: GrantContext,
): Promise<KeyValuePair[]> {
  const env: KeyValuePair[] = [];
  for (const grant of manifest.grants) {
    env.push(...(await notionEnv(grant, ctx)));
    env.push(...(await githubEnv(grant, ctx)));
    env.push(...(await secretEnv(grant, ctx)));
  }
  env.push(...buildSesEnv(manifest));
  logger.info({
    event: 'sandbox.run.grants_injected',
    agentId: ctx.agentId,
    grantCount: manifest.grants.length,
    envVarCount: env.length,
  });
  return env;
}
