# M4 status — real SPA deploy, authenticated E2E, admin users CLI

M4 per the [milestone plan](1.0-definition.md#milestone-plan-criteria-mapped):
**AC-3.1, AC-3.3, AC-3.4, AC-3.6, AC-4.1–4.4.** Complete. (AC-2.6 was
delivered ahead of schedule in M3; AC-3.2/AC-3.5 land in later
milestones/were already covered — see
[status-m3.md](status-m3.md).)

## What landed

1. **Real SPA deploy, `PLACEHOLDER_INDEX` retired for first-party deploys**
   (AC-4.1) —
   [`web-stack.ts`](../../packages/infra/src/stacks/web-stack.ts) ships
   `packages/web/dist` when present; `AV_DEPLOY_WEB=1` (set by both deploy
   jobs) makes it **throw** instead of silently shipping the placeholder if
   `dist` is missing. Credential-free `cdk synth`/CI still gets the
   placeholder with a CDK annotation warning, so `pnpm build` isn't a
   precondition for every contributor. A `webDistPathOverride` test seam
   ([`web-stack.test.ts`](../../packages/infra/src/stacks/web-stack.test.ts),
   4 tests) exercises both branches against temp dirs instead of coupling
   the suite to whatever happens to be on disk.
2. **CI/CD documented + deploy playbook refreshed** (AC-4.2, AC-4.3) —
   `deploy.yml` now bakes `VITE_COGNITO_*`/`VITE_API_BASE_URL` into the
   build (Vite inlines `import.meta.env` at compile time) and sets
   `AV_DEPLOY_WEB=1` on `cdk deploy` for both dev and prod jobs;
   [deploy-env.md](../playbooks/deploy-env.md) walks the first-deploy
   chicken-and-egg (auth/API stacks first to mint the pool id, then
   populate the `VITE_*` GH secrets, then redeploy web) and lists every
   required secret per environment.
3. **Authenticated E2E un-`fixme`'d and green in CI** (AC-4.4) — a new auth
   seam ([`auth-client.ts`](../../packages/web/src/auth/auth-client.ts))
   sits between `AuthProvider`/the API client and `aws-amplify/auth`; a
   Playwright fixture
   ([`fixtures/auth.ts`](../../packages/web/e2e/fixtures/auth.ts)) flips it
   into an in-memory mock session + in-memory `/agents*`/`/me/budget` route
   stubs ([`fixtures/mock-api-state.ts`](../../packages/web/e2e/fixtures/mock-api-state.ts),
   [`fixtures/mock-api-routes.ts`](../../packages/web/e2e/fixtures/mock-api-routes.ts))
   before any app script runs, so `mvp.spec.ts`'s sign-in → create agent →
   run-now → replay happy path
   ([`mvp.spec.ts`](../../packages/web/e2e/mvp.spec.ts)) runs hermetically
   with no deployed Cognito. The same fixture supports a **real-Cognito
   mode** — `AV_E2E_STORAGE_STATE` replays a captured session against a real
   deployed env, guarded by an `assertNotProd` check on
   `AV_E2E_ENV`/`AV_E2E_BASE_URL`/`VITE_COGNITO_USER_POOL_ID` — documented
   with the full env-var contract in
   [e2e/README.md](../../packages/web/e2e/README.md). `ci.yml` installs
   Chromium and runs `pnpm e2e` (mocked mode only; `phase3-sandbox.spec.ts`
   stays opt-in via `E2E_AWS=1`).
4. **`village admin users`** — `list` / `disable` / `enable` / `reset-password`
   ([`admin-users-*.ts`](../../packages/cli/src/commands/), wired in
   [`cli.ts`](../../packages/cli/src/cli.ts)) operate against Cognito Admin
   APIs (via a thin
   [`admin-cognito.ts`](../../packages/cli/src/commands/admin-cognito.ts)
   wrapper) plus the data layer, gated to operator AWS credentials — no more
   than these verbs, satisfying the AC-3.1 anti-scope boundary. `enable` is
   an extra convenience verb beyond the AC-3.1 list, kept thin (same
   Cognito-admin-API shape as `disable`) rather than expanding scope.
5. **No in-app RBAC surface** (AC-3.6, negative) — unchanged by this
   milestone; still no roles endpoint or role field consumed for authz.
   Google sign-in (AC-3.3) and email/password (AC-3.4) both continue to flow
   through `AuthProvider`/`auth-client.ts` unchanged in real (non-mock)
   mode.
6. **[`manage-accounts.md`](../playbooks/manage-accounts.md)** — new
   playbook documenting the operator-as-admin model: console CRUD, the thin
   CLI, and per-user budgets; linked from
   [playbooks/README.md](../playbooks/README.md).

## Verifier outcome

- `pnpm format` (prettier over the full changed-file set): all files
  already formatted, no diffs.
- `pnpm typecheck`, `pnpm lint`: clean across all 16 packages.
- `pnpm test`: **805 passed, 1 skipped** across all 16 packages (web 63,
  infra 58+1 skipped — including the 4 new `web-stack.test.ts` cases — cli
  101, including the 14 new `admin-cognito.test.ts` and 7 new
  `admin-users.test.ts` cases).
- `pnpm e2e` (`mvp.spec.ts`, mocked-auth mode): **2/2 passed**, including
  the previously-`fixme`'d authenticated happy path (sign in → create agent
  → run-now → replay, with an explicit assertion that `replayOfRunId` on
  the second run points back at the first run — not just prompt-hash
  equality).

No deviations from the manifest; all required files present, nothing extra
beyond this status doc.
