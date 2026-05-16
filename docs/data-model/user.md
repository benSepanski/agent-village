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

- Created on first authenticated request via `services/user.ensureProfile`.
- Never deleted in Phase 1. Account deletion is a Phase 7+ feature.
- The Zod schema is in `packages/shared/src/schemas/user.ts` (Phase 1).
