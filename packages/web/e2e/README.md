# Web end-to-end tests

`pnpm e2e` (Playwright, config at the repo root `playwright.config.ts`) runs
everything in this directory against `AV_E2E_BASE_URL` (default
`http://127.0.0.1:5173`, starting the web dev server automatically unless
`AV_E2E_NO_SERVER=1`).

Two tiers of spec live here:

| Spec                     | Needs                                | Runs by default |
| ------------------------ | ------------------------------------ | --------------- |
| `smoke.spec.ts`          | nothing (unauthenticated SPA)        | yes             |
| `mvp.spec.ts`            | nothing — authed portion runs mocked | yes             |
| `phase3-sandbox.spec.ts` | a **deployed AWS environment**       | no — opt-in     |

## Authenticated tests (`fixtures/auth.ts`)

`mvp.spec.ts`'s "happy path" test (sign in, create agent, run-now, replay)
uses `authedTest` from `fixtures/auth.ts` instead of the plain Playwright
`test`. There is no deployed Cognito in CI, so the fixture supports two
modes:

- **Mock mode (default, used by CI).** The app's auth calls
  (`src/auth/auth-client.ts`) are swapped for an in-memory session via
  `window.__AV_AUTH_MODE__`/`window.__AV_MOCK_SESSION__`, set with
  `page.addInitScript` before any app script runs. Every `/agents*` and
  `/me/budget` request is fulfilled by an in-memory store
  (`fixtures/mock-api-state.ts` / `fixtures/mock-api-routes.ts`) — fully
  hermetic, no real network calls, no secrets.
- **Real-Cognito mode.** Set `AV_E2E_STORAGE_STATE` to a Playwright
  storage-state file captured against a real deployed pool (see
  `phase3-sandbox.spec.ts`'s fixture setup below); mock auth/API
  installation is skipped and the test drives the real UI against the real
  API with that session.

### Env contract

| Var                         | Mode | Meaning                                                                      |
| --------------------------- | ---- | ---------------------------------------------------------------------------- |
| _(none)_                    | mock | Default. Hermetic; no external calls. Used by CI.                            |
| `AV_E2E_STORAGE_STATE`      | real | Path to a captured Playwright storage-state file; enables real-Cognito mode. |
| `AV_E2E_ENV`                | real | Consulted by the prod-refusal guard.                                         |
| `AV_E2E_BASE_URL`           | real | Target URL; also consulted by the prod-refusal guard.                        |
| `VITE_COGNITO_USER_POOL_ID` | real | If set in the environment, also consulted by the prod-refusal guard.         |

**Security:** no test credentials are committed to the repo. Mock mode uses
a fake in-memory session (`fixtures/auth.ts`'s `DEFAULT_SESSION`) — never a
real token. Real mode reads `AV_E2E_STORAGE_STATE` from a gitignored file,
or (in the deploy pipeline) from a one-time storage-capture step driven by
GH secrets (`AV_E2E_USER_EMAIL`/`AV_E2E_PASSWORD`) that are never committed
or echoed. Before using a captured real session, the fixture refuses to run
if `AV_E2E_ENV`, `AV_E2E_BASE_URL`, or `VITE_COGNITO_USER_POOL_ID` looks
prod-like (matches `/prod/i`) — see `assertNotProd` in `fixtures/auth.ts`.

## Phase 3 sandbox acceptance (`phase3-sandbox.spec.ts`)

These tests launch real ECS sandbox runs through the UI and assert the Phase 3
safety guarantees end to end: a forced spend breach flips the run to
`spend_limit_exceeded` mid-run, a forced hang is killed at
`manifest.timeoutMinutes`, and the run viewer shows the reconciled **actual**
cost rather than the flat launch reservation. The same invariants are verified
without AWS at the integration level by
`packages/services/src/sandbox-acceptance.test.ts`; run this spec when you
want proof against a live deployment.

Every test skips unless `E2E_AWS=1`.

### One-time fixtures (per environment)

1. **Authenticated storage state.** Sign in once and save the browser state:

   ```bash
   npx playwright codegen "$AV_E2E_BASE_URL" --save-storage=.e2e-auth.json
   ```

   (Complete the Google/Cognito sign-in in the codegen browser, then close it.)

2. **Breach agent** — a manifest app that loops metered Anthropic calls until
   the gateway answers 402, e.g. seed the workspace with:

   ```js
   // burn.mjs — exits 1 when the metering gateway cuts it off
   for (;;) {
     const res = await fetch(`${process.env.ANTHROPIC_BASE_URL}/v1/messages`, {
       method: 'POST',
       headers: {
         'x-api-key': process.env.ANTHROPIC_API_KEY,
         'anthropic-version': '2023-06-01',
         'content-type': 'application/json',
       },
       body: JSON.stringify({
         model: 'claude-haiku-4-5-20251001',
         max_tokens: 512,
         messages: [{ role: 'user', content: 'count to one hundred slowly' }],
       }),
     });
     if (res.status === 402) process.exit(1);
   }
   ```

   Manifest: `command: ["node", "/workspace/burn.mjs"]`, `timeoutMinutes: 5`,
   no extra egress. Set the agent's `spendLimitUsd` barely above the flat
   compute reservation (shown as the running run's initial cost, or from
   `estimateSandboxCost`) so the second/third LLM call breaches.

3. **Hang agent** — a manifest whose command never exits:
   `command: ["bash", "-c", "sleep infinity"]`, `timeoutMinutes: 1`. The
   in-container `timeout` (exit 124) or the StopTask watchdog ends it; either
   way the run must land on `timed_out`.

### Running

```bash
E2E_AWS=1 \
AV_E2E_BASE_URL=https://<your-web-url> \
AV_E2E_NO_SERVER=1 \
AV_E2E_STORAGE_STATE=.e2e-auth.json \
AV_E2E_BREACH_AGENT_ID=<agent-ulid> \
AV_E2E_HANG_AGENT_ID=<agent-ulid> \
pnpm e2e packages/web/e2e/phase3-sandbox.spec.ts
```

Optional knobs:

- `AV_E2E_FLAT_COST_USD` — the agent's flat launch reservation in USD; when
  set, the breach test additionally asserts the displayed cost is **below**
  it (actual < flat, since the app dies early).
- `AV_E2E_RUN_WAIT_MS` — how long to poll for a terminal status (default 15
  minutes; must exceed the agents' `timeoutMinutes` plus the 2-minute
  watchdog grace).

Each scenario consumes real spend from the agent's budget; reset
`spendUsedUsd` (or raise the limit) between breach-test runs.
