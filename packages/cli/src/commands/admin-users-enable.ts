import { AdminEnableUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { kv } from '../format.js';
import {
  type AdminUsersActionOptions,
  getCognitoClient,
  parseEmail,
  parseEnv,
  resolveRegion,
  resolveUserPoolId,
  resolveUsername,
} from './admin-cognito.js';

/** `village admin users enable <email>`: AdminEnableUser — restores sign-in. */
export async function adminUsersEnable(
  email: string,
  opts: AdminUsersActionOptions,
): Promise<string> {
  const env = parseEnv(opts.env);
  const parsedEmail = parseEmail(email);
  const region = resolveRegion(opts.region);
  const client = getCognitoClient(region);
  const poolId = await resolveUserPoolId(env, region, opts.userPoolId);
  const username = await resolveUsername(client, poolId, parsedEmail);
  await client.send(new AdminEnableUserCommand({ UserPoolId: poolId, Username: username }));
  return kv([
    ['email', parsedEmail],
    ['action', 'enabled'],
  ]);
}
