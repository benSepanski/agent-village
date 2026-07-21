import { ListUsersCommand, type UserType } from '@aws-sdk/client-cognito-identity-provider';
import { table } from '../format.js';
import {
  getCognitoClient,
  parseEnv,
  resolveRegion,
  resolveUserPoolId,
  userProviderKind,
} from './admin-cognito.js';

export interface AdminUsersListOptions {
  env: string;
  region?: string | undefined;
  userPoolId?: string | undefined;
}

function emailOf(user: UserType): string {
  return user.Attributes?.find((a) => a.Name === 'email')?.Value ?? '(no email)';
}

function statusOf(user: UserType): string {
  if (user.Enabled === false) return 'disabled';
  return (user.UserStatus ?? 'UNKNOWN').toLowerCase();
}

async function fetchAllUsers(
  client: ReturnType<typeof getCognitoClient>,
  poolId: string,
): Promise<UserType[]> {
  const users: UserType[] = [];
  let token: string | undefined;
  do {
    const res = await client.send(
      new ListUsersCommand({ UserPoolId: poolId, PaginationToken: token }),
    );
    users.push(...(res.Users ?? []));
    token = res.PaginationToken;
  } while (token);
  return users;
}

/** `village admin users list --env <dev|prod>`: every user in the pool, one row each. */
export async function adminUsersList(opts: AdminUsersListOptions): Promise<string> {
  const env = parseEnv(opts.env);
  const region = resolveRegion(opts.region);
  const client = getCognitoClient(region);
  const poolId = await resolveUserPoolId(env, region, opts.userPoolId);
  const users = await fetchAllUsers(client, poolId);
  if (users.length === 0) return '(no users)';
  return table(
    ['email', 'username', 'status', 'provider'],
    users.map((user) => [
      emailOf(user),
      user.Username ?? '(none)',
      statusOf(user),
      userProviderKind(user),
    ]),
  );
}
