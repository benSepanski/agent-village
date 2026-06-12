# User entity

One row per signed-up user, identified by their Cognito `sub`.

## Shape

| pk                  | sk        | gsi1pk | gsi1sk | attrs                               |
| ------------------- | --------- | ------ | ------ | ----------------------------------- |
| `USER#<cognitoSub>` | `PROFILE` | —      | —      | `email`, `displayName`, `createdAt` |

## Access patterns

| What I want               | Operation                          |
| ------------------------- | ---------------------------------- |
| My profile by Cognito sub | `GetItem pk=USER#<sub> sk=PROFILE` |

## Lifecycle

- Created on first authenticated request via [`ensureProfile()` in `services/user.ts`](../../packages/services/src/user.ts).
- There is no account-deletion flow; multi-user features are on the roadmap ([phases](../phases/phase-2-plus.md)).
- The Zod schema is [`packages/shared/src/schemas/user.ts`](../../packages/shared/src/schemas/user.ts).
