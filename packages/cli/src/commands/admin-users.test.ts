import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminResetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { setCognitoClient } from './admin-cognito.js';
import { adminUsersDisable } from './admin-users-disable.js';
import { adminUsersEnable } from './admin-users-enable.js';
import { adminUsersList } from './admin-users-list.js';
import { adminUsersResetPassword } from './admin-users-reset-password.js';

const send = vi.fn();
const fakeClient = { send } as never;

const OPTS = { env: 'dev', region: 'us-east-1', userPoolId: 'pool-dev' };

beforeEach(() => {
  send.mockReset();
  setCognitoClient(fakeClient);
});

afterEach(() => {
  setCognitoClient(undefined);
});

describe('adminUsersList', () => {
  it('renders one row per user with email, username, status, and provider', async () => {
    send.mockResolvedValueOnce({
      Users: [
        {
          Username: 'cog-sub-abc',
          UserStatus: 'CONFIRMED',
          Enabled: true,
          Attributes: [{ Name: 'email', Value: 'a@example.com' }],
        },
        {
          Username: 'Google_1234567890',
          UserStatus: 'EXTERNAL_PROVIDER',
          Enabled: false,
          Attributes: [{ Name: 'email', Value: 'g@example.com' }],
        },
      ],
    });
    const out = await adminUsersList(OPTS);
    expect(out).toContain('a@example.com');
    expect(out).toContain('confirmed');
    expect(out).toContain('cognito');
    expect(out).toContain('g@example.com');
    expect(out).toContain('disabled');
    expect(out).toContain('google');
  });

  it('paginates ListUsers via PaginationToken', async () => {
    send
      .mockResolvedValueOnce({
        Users: [{ Username: 'u1', Attributes: [{ Name: 'email', Value: 'u1@example.com' }] }],
        PaginationToken: 'page-2',
      })
      .mockResolvedValueOnce({
        Users: [{ Username: 'u2', Attributes: [{ Name: 'email', Value: 'u2@example.com' }] }],
      });
    const out = await adminUsersList(OPTS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(out).toContain('u1@example.com');
    expect(out).toContain('u2@example.com');
  });

  it('returns a friendly message for an empty pool', async () => {
    send.mockResolvedValueOnce({ Users: [] });
    expect(await adminUsersList(OPTS)).toBe('(no users)');
  });
});

describe('adminUsersDisable', () => {
  it('resolves the username by email then calls AdminDisableUser', async () => {
    send.mockResolvedValueOnce({ Users: [{ Username: 'cog-sub-abc' }] }).mockResolvedValueOnce({});
    const out = await adminUsersDisable('a@example.com', OPTS);
    expect(out).toContain('disabled');
    const cmd = send.mock.calls[1]![0] as AdminDisableUserCommand;
    expect(cmd).toBeInstanceOf(AdminDisableUserCommand);
    expect(cmd.input).toEqual({ UserPoolId: 'pool-dev', Username: 'cog-sub-abc' });
  });
});

describe('adminUsersEnable', () => {
  it('resolves the username by email then calls AdminEnableUser', async () => {
    send.mockResolvedValueOnce({ Users: [{ Username: 'cog-sub-abc' }] }).mockResolvedValueOnce({});
    const out = await adminUsersEnable('a@example.com', OPTS);
    expect(out).toContain('enabled');
    const cmd = send.mock.calls[1]![0] as AdminEnableUserCommand;
    expect(cmd).toBeInstanceOf(AdminEnableUserCommand);
    expect(cmd.input).toEqual({ UserPoolId: 'pool-dev', Username: 'cog-sub-abc' });
  });
});

describe('adminUsersResetPassword', () => {
  it('sends a reset-password code for a native Cognito user', async () => {
    send
      .mockResolvedValueOnce({ Users: [{ Username: 'cog-sub-abc' }] })
      .mockResolvedValueOnce({ Username: 'cog-sub-abc', UserStatus: 'CONFIRMED' })
      .mockResolvedValueOnce({});
    const out = await adminUsersResetPassword('a@example.com', OPTS);
    expect(out).toContain('reset-password code sent');
    const cmd = send.mock.calls[2]![0] as AdminResetUserPasswordCommand;
    expect(cmd).toBeInstanceOf(AdminResetUserPasswordCommand);
    expect(cmd.input).toEqual({ UserPoolId: 'pool-dev', Username: 'cog-sub-abc' });
  });

  it('refuses to reset a Google-federated user without calling AdminResetUserPassword', async () => {
    send
      .mockResolvedValueOnce({ Users: [{ Username: 'Google_123' }] })
      .mockResolvedValueOnce({ Username: 'Google_123', UserStatus: 'EXTERNAL_PROVIDER' });
    await expect(adminUsersResetPassword('g@example.com', OPTS)).rejects.toThrow(
      /signs in with Google/,
    );
    expect(send).toHaveBeenCalledTimes(2);
  });
});
