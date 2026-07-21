/**
 * Cognito Admin API seam for `village admin users *`. Unlike every other CLI
 * command, this category talks to AWS directly with the operator's own
 * credentials (default provider chain) instead of the village HTTP API —
 * there is no `client.ts` bearer token involved. Follows the lazy
 * singleton + setter test seam already used for the ECS/STS clients in
 * `@agent-village/services/sandbox.ts`.
 */

import {
  AdminGetUserCommand,
  type AdminGetUserCommandOutput,
  CognitoIdentityProviderClient,
  ListUserPoolsCommand,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { z } from '@agent-village/shared';
import { formatZodError } from './zod-errors.js';

/** Shared option shape for every `village admin users <verb>` command. */
export interface AdminUsersActionOptions {
  env: string;
  region?: string | undefined;
  userPoolId?: string | undefined;
}

let cognitoClient: CognitoIdentityProviderClient | undefined;

/** Lazy singleton; `region` only takes effect on first construction. */
export function getCognitoClient(region: string): CognitoIdentityProviderClient {
  cognitoClient ??= new CognitoIdentityProviderClient({ region });
  return cognitoClient;
}

/** Test-only: inject (or clear with `undefined`) the Cognito client. */
export function setCognitoClient(client: CognitoIdentityProviderClient | undefined): void {
  cognitoClient = client;
}

/** --region flag, else AWS_REGION, else us-east-1 (mirrors services/sandbox.ts). */
export function resolveRegion(region?: string): string {
  return region ?? process.env['AWS_REGION'] ?? 'us-east-1';
}

const EnvName = z.enum(['dev', 'prod']);

/** Validates --env is exactly 'dev' or 'prod' — fails fast, no round trip. */
export function parseEnv(env: string): 'dev' | 'prod' {
  const result = EnvName.safeParse(env);
  if (!result.success) throw new Error(formatZodError(result.error));
  return result.data;
}

/** Validates the <email> argument locally before any Cognito round trip. */
export function parseEmail(email: string): string {
  const result = z.string().email().safeParse(email);
  if (!result.success) throw new Error(formatZodError(result.error));
  return result.data;
}

/**
 * Resolves the Cognito user pool id for an env: an explicit --user-pool-id
 * override, then AV_USER_POOL_ID, then a ListUserPools lookup by the
 * `agent-village-<env>` naming convention (the pool's `userPoolName`, see
 * `auth-stack.ts`'s `buildUserPool`; `UserPoolId` is output from the
 * `-api` stack per `api-stack.ts`, not `-auth`).
 */
export async function resolveUserPoolId(
  env: 'dev' | 'prod',
  region: string,
  override?: string,
): Promise<string> {
  if (override) return override;
  const fromEnv = process.env['AV_USER_POOL_ID'];
  if (fromEnv) return fromEnv;
  const client = getCognitoClient(region);
  const name = `agent-village-${env}`;
  let token: string | undefined;
  do {
    const res = await client.send(new ListUserPoolsCommand({ MaxResults: 60, NextToken: token }));
    const found = res.UserPools?.find((pool) => pool.Name === name);
    if (found?.Id) return found.Id;
    token = res.NextToken;
  } while (token);
  throw new Error(`user pool for env ${env} not found — pass --user-pool-id`);
}

/**
 * Resolves the Cognito Username for an email via a server-side ListUsers
 * filter. Admin* APIs need Username (the sub, for email-alias pools), not
 * the email itself. Errors on zero or more than one match.
 */
export async function resolveUsername(
  client: CognitoIdentityProviderClient,
  poolId: string,
  email: string,
): Promise<string> {
  const res = await client.send(
    new ListUsersCommand({ UserPoolId: poolId, Filter: `email = "${email}"` }),
  );
  const users = res.Users ?? [];
  if (users.length === 0) throw new Error(`no user found for email ${email}`);
  if (users.length > 1) throw new Error(`multiple users found for email ${email} — ambiguous`);
  const username = users[0]?.Username;
  if (!username) throw new Error(`user for email ${email} has no Username`);
  return username;
}

/** Full user record for a resolved username — used by reset-password's provider-kind guard. */
export async function getUserDetail(
  client: CognitoIdentityProviderClient,
  poolId: string,
  username: string,
): Promise<AdminGetUserCommandOutput> {
  return client.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: username }));
}

/**
 * Detects Google-federated users: Cognito marks them `UserStatus:
 * EXTERNAL_PROVIDER` and names them `Google_<sub>` (see
 * `UserPoolClientIdentityProvider.GOOGLE` in `auth-stack.ts`). They have no
 * Cognito password, so `reset-password` refuses for them.
 */
export function userProviderKind(user: {
  Username?: string | undefined;
  UserStatus?: string | undefined;
}): 'google' | 'cognito' {
  if (user.UserStatus === 'EXTERNAL_PROVIDER') return 'google';
  if (user.Username?.startsWith('Google_')) return 'google';
  return 'cognito';
}
