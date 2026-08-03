# Phase 1, Step 10 — Web auth

Wire Cognito (email + Google) into the SPA using `aws-amplify`.

## Files to create / modify

```
packages/web/src/
├── auth/
│   ├── amplify-config.ts       # Reads VITE_COGNITO_USER_POOL_ID, etc., from import.meta.env
│   ├── AuthProvider.tsx        # Wraps the app, exposes useAuth()
│   └── ProtectedRoute.tsx
├── api-client/
│   ├── client.ts               # fetch wrapper that attaches Cognito JWT
│   └── types.ts                # re-exports Zod schemas from @agent-village/shared
└── main.tsx                    # add AuthProvider + Router
```

## Behavior

- Email/password sign-up + verify-email flow.
- Google federation via Cognito hosted UI.
- A protected layout that renders only when `useAuth().user` is set; otherwise redirects to `/login`.
- The API client attaches the Cognito ID token as a `Authorization: Bearer ...` header on every request.

## Env vars (Vite)

`VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_COGNITO_DOMAIN`, `VITE_API_BASE_URL`. Set in `.env.local` for dev, baked into the build for deployed envs.

## Acceptance

- Sign-up with email + verification code works (against LocalStack Cognito for dev runs).
- Sign-in with Google works against the deployed dev environment.
- `pnpm --filter @agent-village/web test` covers `AuthProvider` and `ProtectedRoute` with mocked Amplify.

## Reference

- [add-frontend-route playbook](../../playbooks/add-frontend-route.md)
