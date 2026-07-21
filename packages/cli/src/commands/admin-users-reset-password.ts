import { AdminResetUserPasswordCommand } from '@aws-sdk/client-cognito-identity-provider';
import { kv } from '../format.js';
import {
  type AdminUsersActionOptions,
  getCognitoClient,
  getUserDetail,
  parseEmail,
  parseEnv,
  resolveRegion,
  resolveUserPoolId,
  resolveUsername,
  userProviderKind,
} from './admin-cognito.js';

/**
 * `village admin users reset-password <email>`: AdminResetUserPassword —
 * Cognito emails/texts the user a reset code and forces FORCE_CHANGE_PASSWORD
 * on their next sign-in. Refuses for Google-federated users: they have no
 * Cognito password to reset.
 */
export async function adminUsersResetPassword(
  email: string,
  opts: AdminUsersActionOptions,
): Promise<string> {
  const env = parseEnv(opts.env);
  const parsedEmail = parseEmail(email);
  const region = resolveRegion(opts.region);
  const client = getCognitoClient(region);
  const poolId = await resolveUserPoolId(env, region, opts.userPoolId);
  const username = await resolveUsername(client, poolId, parsedEmail);
  const detail = await getUserDetail(client, poolId, username);
  if (userProviderKind(detail) === 'google') {
    throw new Error(
      `${parsedEmail} signs in with Google — there is no Cognito password to reset. ` +
        'They should use "Sign in with Google" instead.',
    );
  }
  await client.send(new AdminResetUserPasswordCommand({ UserPoolId: poolId, Username: username }));
  return kv([
    ['email', parsedEmail],
    ['action', 'reset-password code sent'],
  ]);
}
