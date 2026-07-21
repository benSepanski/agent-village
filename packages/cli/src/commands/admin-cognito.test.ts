import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AdminGetUserCommand,
  ListUserPoolsCommand,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  getUserDetail,
  parseEmail,
  parseEnv,
  resolveRegion,
  resolveUserPoolId,
  resolveUsername,
  setCognitoClient,
  userProviderKind,
} from './admin-cognito.js';

const send = vi.fn();
const fakeClient = { send } as never;

beforeEach(() => {
  send.mockReset();
  setCognitoClient(fakeClient);
});

afterEach(() => {
  setCognitoClient(undefined);
  delete process.env['AV_USER_POOL_ID'];
  delete process.env['AWS_REGION'];
});

describe('resolveRegion', () => {
  it('prefers the flag, then AWS_REGION, then us-east-1', () => {
    expect(resolveRegion('eu-west-1')).toBe('eu-west-1');
    process.env['AWS_REGION'] = 'ap-south-1';
    expect(resolveRegion()).toBe('ap-south-1');
    delete process.env['AWS_REGION'];
    expect(resolveRegion()).toBe('us-east-1');
  });
});

describe('parseEnv / parseEmail', () => {
  it('accepts dev and prod, rejects anything else', () => {
    expect(parseEnv('dev')).toBe('dev');
    expect(parseEnv('prod')).toBe('prod');
    expect(() => parseEnv('staging')).toThrow(/Invalid input/);
  });

  it('accepts a well-formed email and rejects garbage', () => {
    expect(parseEmail('a@example.com')).toBe('a@example.com');
    expect(() => parseEmail('not-an-email')).toThrow(/Invalid input/);
  });
});

describe('resolveUserPoolId', () => {
  it('returns the override without calling Cognito', async () => {
    const id = await resolveUserPoolId('dev', 'us-east-1', 'pool-override');
    expect(id).toBe('pool-override');
    expect(send).not.toHaveBeenCalled();
  });

  it('returns AV_USER_POOL_ID without calling Cognito', async () => {
    process.env['AV_USER_POOL_ID'] = 'pool-from-env';
    const id = await resolveUserPoolId('dev', 'us-east-1');
    expect(id).toBe('pool-from-env');
    expect(send).not.toHaveBeenCalled();
  });

  it('paginates ListUserPools and matches by agent-village-<env> name', async () => {
    send
      .mockResolvedValueOnce({
        UserPools: [{ Id: 'pool-other', Name: 'agent-village-prod' }],
        NextToken: 'page-2',
      })
      .mockResolvedValueOnce({ UserPools: [{ Id: 'pool-dev', Name: 'agent-village-dev' }] });
    const id = await resolveUserPoolId('dev', 'us-east-1');
    expect(id).toBe('pool-dev');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0]).toBeInstanceOf(ListUserPoolsCommand);
  });

  it('throws a clear error when no pool matches', async () => {
    send.mockResolvedValueOnce({ UserPools: [] });
    await expect(resolveUserPoolId('prod', 'us-east-1')).rejects.toThrow(
      'user pool for env prod not found — pass --user-pool-id',
    );
  });
});

describe('resolveUsername', () => {
  it('filters ListUsers by email and returns the single Username', async () => {
    send.mockResolvedValueOnce({ Users: [{ Username: 'cog-sub-abc' }] });
    const username = await resolveUsername(fakeClient, 'pool-dev', 'a@example.com');
    expect(username).toBe('cog-sub-abc');
    const cmd = send.mock.calls[0]![0] as ListUsersCommand;
    expect(cmd).toBeInstanceOf(ListUsersCommand);
    expect(cmd.input.UserPoolId).toBe('pool-dev');
    expect(cmd.input.Filter).toBe('email = "a@example.com"');
  });

  it('throws when no user matches', async () => {
    send.mockResolvedValueOnce({ Users: [] });
    await expect(resolveUsername(fakeClient, 'pool-dev', 'nobody@example.com')).rejects.toThrow(
      'no user found for email nobody@example.com',
    );
  });

  it('throws when more than one user matches', async () => {
    send.mockResolvedValueOnce({ Users: [{ Username: 'a' }, { Username: 'b' }] });
    await expect(resolveUsername(fakeClient, 'pool-dev', 'dup@example.com')).rejects.toThrow(
      'multiple users found for email dup@example.com — ambiguous',
    );
  });
});

describe('getUserDetail', () => {
  it('calls AdminGetUser with the pool and username', async () => {
    send.mockResolvedValueOnce({ Username: 'cog-sub-abc', UserStatus: 'CONFIRMED' });
    await getUserDetail(fakeClient, 'pool-dev', 'cog-sub-abc');
    const cmd = send.mock.calls[0]![0] as AdminGetUserCommand;
    expect(cmd).toBeInstanceOf(AdminGetUserCommand);
    expect(cmd.input).toEqual({ UserPoolId: 'pool-dev', Username: 'cog-sub-abc' });
  });
});

describe('userProviderKind', () => {
  it('detects Google-federated users by UserStatus', () => {
    expect(userProviderKind({ UserStatus: 'EXTERNAL_PROVIDER' })).toBe('google');
  });

  it('detects Google-federated users by Username prefix', () => {
    expect(userProviderKind({ Username: 'Google_123456789' })).toBe('google');
  });

  it('treats everything else as a native Cognito user', () => {
    expect(userProviderKind({ Username: 'cog-sub-abc', UserStatus: 'CONFIRMED' })).toBe('cognito');
  });
});
