# Playbook: manage accounts (`village admin users`)

Operator-only account administration: list, disable, enable, or send a
password-reset code for a Cognito user. Unlike every other `village`
command, `admin users` does **not** go through the village HTTP API — it
calls Cognito's Admin APIs directly with **your own AWS credentials** (the
default provider chain: `aws login`/`aws sso login` session, `AWS_PROFILE`,
or an env var/instance credential). There is no in-app role or RBAC surface
in agent-village ([user-auth](../key-properties/user-auth.md)); this CLI
category is the entire admin surface, and it is intentionally narrow —
exactly `list`, `disable`, `enable`, `reset-password`. No more.

Source: [`packages/cli/src/commands/admin-cognito.ts`](../../packages/cli/src/commands/admin-cognito.ts)
(the Cognito client seam + pool/username resolution) and
[`admin-users-list.ts`](../../packages/cli/src/commands/admin-users-list.ts) /
[`admin-users-disable.ts`](../../packages/cli/src/commands/admin-users-disable.ts) /
[`admin-users-enable.ts`](../../packages/cli/src/commands/admin-users-enable.ts) /
[`admin-users-reset-password.ts`](../../packages/cli/src/commands/admin-users-reset-password.ts)
(the four verbs).

## Prerequisites

- The `village` CLI installed (`pnpm --filter @agent-village/cli bundle`, or
  run from source with `pnpm --filter @agent-village/cli exec tsx bin/village.js`).
  This is unrelated to `village login` — admin commands never read the
  CLI's persisted config or the OS-keychain refresh token.
- AWS credentials for an IAM principal that can call Cognito's Admin APIs
  against the target pool. If you followed
  [deploy-env](deploy-env.md)'s `AdministratorAccess`-based setup, you
  already have this. For a tighter policy, the operator identity needs:

  ```json
  {
    "Effect": "Allow",
    "Action": [
      "cognito-idp:ListUserPools",
      "cognito-idp:ListUsers",
      "cognito-idp:AdminGetUser",
      "cognito-idp:AdminDisableUser",
      "cognito-idp:AdminEnableUser",
      "cognito-idp:AdminResetUserPassword"
    ],
    "Resource": "*"
  }
  ```

  (`ListUserPools` needs `Resource: "*"` — it has no ARN to scope to. The
  `Admin*`/`ListUsers` calls can be scoped to a specific pool ARN once you
  know it.)

## Pool discovery

Every command needs `--env dev|prod` and resolves the Cognito user pool id
in this order:

1. `--user-pool-id <id>` if you pass it explicitly.
2. `AV_USER_POOL_ID` env var, if set.
3. Otherwise, `ListUserPools` and match by name: the pool's
   `userPoolName` is `agent-village-<env>` (`config.prefix` in
   [`auth-stack.ts`](../../packages/infra/src/stacks/auth-stack.ts)'s
   `buildUserPool`). This is a separate lookup from the `UserPoolId`
   CfnOutput on the `-api` stack ([`api-stack.ts`](../../packages/infra/src/stacks/api-stack.ts))
   — the CLI doesn't read CloudFormation outputs, it asks Cognito directly.

`--region` follows the same order as every AWS SDK client in this repo:
`--region` flag, then `AWS_REGION` env var, then `us-east-1`
(`resolveRegion()` in `admin-cognito.ts`, matching `services/sandbox.ts`'s
`clientRegion()`).

If discovery fails you'll see: `user pool for env <env> not found — pass
--user-pool-id`. Fastest fix: copy the pool id from the CloudFormation
console (`-api` stack outputs, `UserPoolId`) and pass `--user-pool-id`.

## Commands

### `village admin users list --env <dev|prod>`

```bash
village admin users list --env dev
```

```
email               username            status      provider
------------------  ------------------  ----------  --------
alice@example.com   a1b2c3d4-...        confirmed   cognito
bob@example.com      Google_10894...     external_provider  google
```

One row per user in the pool: email, the Cognito `Username` (the sub, not
the email — this pool has `signInAliases: { email: true }`, so email is an
alias, not the identifier), `UserStatus` (or `disabled` if `Enabled` is
false), and `provider` (`google` for Google-federated accounts, `cognito`
otherwise — see [Provider detection](#provider-detection) below).

### `village admin users disable <email> --env <dev|prod>`

```bash
village admin users disable alice@example.com --env prod
```

Calls `AdminDisableUser`. The user's existing tokens are **not** revoked
immediately (Cognito access/ID tokens are valid until they expire, up to
the pool's configured 60 minutes — see
[user-auth](../key-properties/user-auth.md)), but they can no longer sign
in again once their session expires. Reversible with `enable`.

This does not touch agent-village's own data (agents, runs, budgets) — a
disabled user's agents keep their existing schedules and can still run
(the scheduled-run path is unauthenticated by design; see
[user-auth](../key-properties/user-auth.md)'s "Known limits"). To actually
stop an agent, delete or pause it via `village agents rm` / the web UI —
account-level disable and agent-level lifecycle are independent.

### `village admin users enable <email> --env <dev|prod>`

```bash
village admin users enable alice@example.com --env prod
```

Calls `AdminEnableUser` — undoes `disable`.

### `village admin users reset-password <email> --env <dev|prod>`

```bash
village admin users reset-password alice@example.com --env prod
```

Calls `AdminResetUserPassword`: Cognito emails the user a reset code and
puts the account into `FORCE_CHANGE_PASSWORD` until they complete the
reset (in the web UI's "Forgot password" flow, or by setting a new
password with the code Cognito sent). This command only **triggers** the
flow — the CLI never sees or sets a password itself.

**Refuses for Google-federated users** (`UserStatus: EXTERNAL_PROVIDER`,
`Username` prefixed `Google_`) with a clear error: they have no Cognito
password to reset, and should just sign in with Google again.

Note: since the pool has `accountRecovery: AccountRecovery.EMAIL_ONLY`
([`auth-stack.ts`](../../packages/infra/src/stacks/auth-stack.ts)), most
users can self-serve via the web UI's "Forgot password" without operator
involvement at all — this command is for cases where that isn't working
(e.g. the user can't access their inbox, or you want to force a rotation).

## Provider detection

`userProviderKind()` in `admin-cognito.ts` treats a user as Google-federated
if either is true:

- `UserStatus === 'EXTERNAL_PROVIDER'` (Cognito's status for a federated
  identity that has never set a Cognito password), or
- `Username` starts with `Google_` (the `Username` Cognito assigns
  federated users from the Google IdP — see
  `UserPoolClientIdentityProvider.GOOGLE` in `auth-stack.ts`).

Everything else is `cognito` (email/password, native to the pool).

## Troubleshooting

| Symptom                                                                   | Cause                                                                                                                     | Fix                                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `user pool for env <env> not found — pass --user-pool-id`                 | `ListUserPools` found no pool named `agent-village-<env>` in the target account/region                                    | Check `--region` matches where you deployed; or pass `--user-pool-id` directly |
| `no user found for email <email>`                                         | No user in the pool has that email attribute                                                                              | Check for typos; run `list` to see the pool's actual users                     |
| `multiple users found for email <email> — ambiguous`                      | Two accounts share an email attribute (shouldn't normally happen — Cognito enforces email uniqueness per pool by default) | Investigate via the Cognito console before proceeding                          |
| `AccessDenied` from Cognito                                               | Your AWS credentials lack the `cognito-idp:Admin*` permissions above                                                      | Attach the policy, or use an `AdministratorAccess` principal                   |
| `<email> signs in with Google — there is no Cognito password to reset...` | You tried `reset-password` on a Google-federated user                                                                     | Nothing to do — ask them to use "Sign in with Google"                          |

## Related

- [deploy-env](deploy-env.md) — the AWS credentials/OIDC setup this playbook builds on.
- [user-auth](../key-properties/user-auth.md) — how sign-in and token validation work end to end.
- [rotate-anthropic-key](rotate-anthropic-key.md) — a different kind of "account" operation (per-agent API key, not user identity).
