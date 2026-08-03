# Branch reconciliation

The outstanding `claude/*` fix branches, reconciled against trunk
content-by-content. This is the source record for the M2 milestone in
[1.0-definition.md](1.0-definition.md#milestone-plan-criteria-mapped) —
"consolidation of the 4 fix branches."

**Baseline:** `origin/main` = `628a6a1`. **Method:** content-level diffing, not
ancestry — PR #23/#24/#25 squash-merged large ranges, so `git log
branch..main` / `main..branch` graphs are misleading; every verdict below was
checked by diffing file content and grepping current `origin/main`, not by
reading commit graphs. **Verdict vocabulary:** `already-merged` (byte-for-byte
or equivalent, present on main), `superseded-by-main` (main solves the same
problem differently/better), `stale-base-noise` (branch predates work main has
since done; diff is the branch _regressing_ main, not adding to it), `novel`
(absent from main, worth landing), `partially-novel` (one real fix mixed with
stale-base regressions in the same file — port the fix, discard the rest).

---

## `phase-3-application-platform`

**Intent:** Build the Phase 3 application platform — metered Anthropic
gateway with a spend cap, run-duration kill switch (EventBridge Scheduler
watchdog), egress proxy allowlisting, secret grants, cost/observability, and a
Gmail reference app — then harden it through two review passes (spend
settlement/watchdog/log-tailing fixes; eight adversarial-review defects
covering non-root sandbox uid, DNS-exemption pinning, ARM64 pricing,
double-spend isolation, run-log polling) and a docs pass marking Phase 3 done.

| File                                                                                                                                     | Verdict            | What main lacks                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/services/src/anthropic-gateway.ts`                                                                                             | superseded-by-main | Nothing — main extracted `gateway-upstream.ts` and added the abort-vs-connection-failure split (499 on deadline abort, avoids double billing) that the branch never had.                               |
| `packages/infra/src/stacks/runner-stack.ts`                                                                                              | superseded-by-main | Nothing — main has the lifecycle/watchdog DLQs, the `rate(5min)` sweeper, and a `runner-iam.ts` extraction the branch predates.                                                                        |
| `packages/services/src/anthropic-gateway.test.ts`                                                                                        | already-merged     | Nothing — covered by the same cherry-pick that landed the source file.                                                                                                                                 |
| `packages/cli/src/auth.ts`                                                                                                               | superseded-by-main | Nothing — no branch commit even touches this file; main's `village login` / credential-store machinery is strictly newer.                                                                              |
| `packages/services/src/runner-sandbox.ts`                                                                                                | superseded-by-main | Nothing — main additionally gates the `costUsd=0` write on winning the reservation claim and swallows `taskArn`-persist failures instead of treating them as launch failures (2026-07-18 audit fixes). |
| `packages/services/src/sandbox.ts`                                                                                                       | superseded-by-main | Nothing — main resolves per-image task definitions via `sandbox-taskdef.ts`, exactly the "not yet honored" follow-up the branch's own comment flags.                                                   |
| `examples/gmail-agent/README.md`                                                                                                         | superseded-by-main | Nothing — main documents the `village` CLI and `manifest.env`; the branch predates both and uses raw `aws-cli`.                                                                                        |
| `docs/roadmap.md`                                                                                                                        | stale-base-noise   | Nothing — branch version predates Phase 4/5 and the production-readiness audit.                                                                                                                        |
| `docs/phases/phase-2-plus.md`                                                                                                            | stale-base-noise   | Nothing — branch version still lists backlog items (`manifest.env`, agent-secrets CLI, per-manifest task defs) main has since delivered.                                                               |
| `packages/data/src/dynamo/runs.ts`                                                                                                       | already-merged     | Nothing — `claimRunReservation` already present on main.                                                                                                                                               |
| `packages/services/src/gateway-usage.ts`                                                                                                 | already-merged     | Nothing — cache-tier billing (1.25x/2x/0.1x) already present verbatim.                                                                                                                                 |
| `packages/services/src/sandbox-watchdog.ts`                                                                                              | already-merged     | Nothing — `WATCHDOG_GRACE_MINUTES=5` already on main.                                                                                                                                                  |
| `packages/infra/sandbox-image/Dockerfile`, `sandbox-stack.ts`                                                                            | already-merged     | Nothing — non-root uid 10001 already on main.                                                                                                                                                          |
| `packages/infra/proxy-image/entrypoint.sh`                                                                                               | already-merged     | Nothing — DNS-exemption-pinned-to-resolvers fix already on main.                                                                                                                                       |
| `packages/domain/src/cost.ts`                                                                                                            | already-merged     | Nothing — Graviton/ARM64 pricing correction already on main.                                                                                                                                           |
| `packages/web/src/components/RunLogs.tsx`                                                                                                | already-merged     | Nothing — "stop polling on terminal status" already present.                                                                                                                                           |
| `docs/notes/2026-07-18-production-readiness-audit.md`, `docs/phases/phase-4-*.md`, `docs/phases/phase-5-*.md`, `docs/app-development.md` | stale-base-noise   | Nothing — these docs were authored on main entirely after the branch diverged; branch never had them.                                                                                                  |
| repo-wide comm check                                                                                                                     | already-merged     | Nothing — `comm -23` of the branch's tree against main's tree is empty: zero files exist on the branch that are absent from main.                                                                      |

**Worth landing:** nothing. Every branch commit is already on `origin/main` —
PR #23 squash-merged the branch's prefix and a dedicated commit (`df6d495`)
explicitly cherry-picked the exact tail range the squash missed. Main's
subsequent Phase 4/5 and production-readiness-audit work (PRs #24/#25) then
hardened the same subsystems well beyond what the branch ever had. This
branch is fully reconciled and can be deleted with no cherry-pick follow-up.

---

## `origin/claude/bug-fixes-test-pass-i5ctw3`

**Intent:** Single commit (`3fd5aa5`) claims to fix three launch-review gaps:
(1) wire CloudWatch EMF metric emission so the `runs.error` /
`runs.spend_limit_exceeded` alarms fire, (2) add Google OAuth federation to
Cognito, (3) pin the prod AWS account so CDK refuses mismatched credentials.
In reality the branch was authored against a very old ancestor — its tree is
missing `runner-sandbox.ts`, `sandbox-lifecycle.ts`, `sandbox-sweeper.ts`,
`run-logs.ts`, `run-queries.ts`, and `anthropic-gateway.ts` entirely — so most
of its diff against main is the branch _reverting_ functionality main
already has, not adding anything.

| File                                                                           | Verdict            | What main lacks                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/observability/logger.ts`                                  | superseded-by-main | Nothing — main solves EMF emission via a targeted `runOutcomeMetric()` helper (`emf.ts`) called only at terminal-run log sites, not the branch's broader "any log call with a `metric` field" mixin.                                                                                                                                                                                                      |
| `packages/shared/src/observability/logger.test.ts`                             | superseded-by-main | Nothing — pinned to the branch's stale `events.ts`; deletes a passing-on-main test.                                                                                                                                                                                                                                                                                                                       |
| `packages/shared/src/observability/events.ts`                                  | partially-novel    | `'agent.run.spend_refunded'` / `'agent.run.spend_refund_failed'` are logged in `runner.ts`, `runner-sandbox.ts`, and `anthropic-gateway.ts` on main, but absent from main's `LOG_EVENTS` union — a real (if low-impact) completeness gap. The rest of the branch's `events.ts` deletes ~35 real entries main has; that part is stale-base noise.                                                          |
| `packages/services/src/runner.ts`                                              | stale-base-noise   | Nothing — branch removes `executeSandboxRun` manifest-agent dispatch and the `run-queries.js` re-exports, all load-bearing on main. Main's `runOutcomeMetric` calls already cover the branch's metric intent.                                                                                                                                                                                             |
| `packages/services/src/runner.test.ts`                                         | stale-base-noise   | Nothing — removes coverage for functionality main still has (`acquireActiveRun`, `claimRunReservation`, etc.).                                                                                                                                                                                                                                                                                            |
| `packages/infra/src/stacks/auth-stack.ts`                                      | partially-novel    | **Google OAuth federation is genuinely absent from main** (only a TODO comment exists). Branch adds a hosted-UI domain, a conditional `UserPoolIdentityProviderGoogle` reading its client secret from Secrets Manager, and conditional `SupportedIdentityProviders`. But the same diff deletes the `CliClient`/`CfnOutput` that main's `village login` still depends on — must be preserved when porting. |
| `packages/infra/src/stacks/auth-stack.test.ts`                                 | novel              | Doesn't exist on main. Three new CDK template-assertion tests (hosted-UI domain, COGNITO-only default, Google federation wiring) — needs adaptation once `CliClient` is restored.                                                                                                                                                                                                                         |
| `packages/infra/config/types.ts`                                               | partially-novel    | `googleClientId?: string` / `oauthCallbackUrls?: readonly string[]` are absent from main's `EnvConfig`. Branch also _deletes_ `sesSenderDomain`, which main's `sandbox-stack.ts`/`sandbox-grants.ts` still read — must add the two new fields alongside, not instead of, the existing one.                                                                                                                |
| `packages/infra/config/index.ts`                                               | novel              | `loadEnvConfig()` on main always lets `CDK_DEFAULT_ACCOUNT` override a config-pinned `account`, defeating the field's own purpose. Branch flips precedence to `base.account ?? process.env['CDK_DEFAULT_ACCOUNT']` so a pinned account actually wins — a real, narrow, verifiable bug fix.                                                                                                                |
| `packages/infra/config/prod.ts`                                                | novel              | `prod.ts` on main never sets `EnvConfig.account`. Branch reads `AV_PROD_ACCOUNT_ID` into it — required alongside the `index.ts` fix for prod pinning to do anything.                                                                                                                                                                                                                                      |
| `packages/infra/config/dev.ts`                                                 | novel              | `oauthCallbackUrls` has zero hits repo-wide on main. Branch adds `['http://localhost:5173']`, needed for the Google-federation callback/logout URLs.                                                                                                                                                                                                                                                      |
| `packages/infra/test/config.test.ts`                                           | novel              | Doesn't exist on main. Three new tests: unknown-env rejection, `CDK_DEFAULT_ACCOUNT` fallback, prod-account-pinning precedence — validates the `index.ts`/`prod.ts` fixes above.                                                                                                                                                                                                                          |
| `.github/workflows/deploy.yml`                                                 | partially-novel    | `AV_PROD_ACCOUNT_ID` has zero hits anywhere in the repo — CI never sets it, so the prod-pinning fix can't take effect in CI without this. Branch also deletes the egress-proxy image build steps, which main still has (ADR 0003) — must not carry that deletion over.                                                                                                                                    |
| `docs/architecture/observability.md`, `docs/conventions/structured-logging.md` | superseded-by-main | Nothing — describe the branch's own (superseded) EMF design as closing a gap main already closed differently.                                                                                                                                                                                                                                                                                             |
| `docs/key-properties/aws-account-and-region.md`                                | novel              | Doc update describing config-pinned account winning over `CDK_DEFAULT_ACCOUNT` — accurate once the `index.ts`/`prod.ts` code lands; main's current doc still says the account is "currently unset" and unenforceable.                                                                                                                                                                                     |
| `docs/key-properties/user-auth.md`                                             | partially-novel    | The "Google federation needs per-env setup" rewrite is accurate documentation for the novel auth-stack.ts work. The same diff deletes the `CliClient` enforcement-table row, which must **not** be carried over — main's CLI auth still depends on it.                                                                                                                                                    |
| `docs/phases/phase-1-mvp.md`                                                   | partially-novel    | Google-federation deviation-bullet rewording is worth keeping once auth-stack.ts lands; the EMF-bullet removal is moot (main resolved EMF differently).                                                                                                                                                                                                                                                   |
| `docs/playbooks/deploy-env.md`                                                 | novel              | Adds a `UserPoolDomain` bullet to the post-deploy stack-outputs list, matching the new `CfnOutput` in auth-stack.ts. Zero hits on main today.                                                                                                                                                                                                                                                             |

**Worth landing:** three things, despite the branch as a whole being built off
a stale ancestor. First, **Google OAuth federation for Cognito is completely
missing from main** — the branch's `auth-stack.ts`/`auth-stack.test.ts` +
`config` field additions are the real fix, provided the `CliClient` deletion
is reverted during the port. Second, **prod account-pinning is a real,
narrow, verifiable bug**: `EnvConfig.account` exists in the type but
`loadEnvConfig()` always lets the ambient `CDK_DEFAULT_ACCOUNT` win, and
`prod.ts` never sets `account` in the first place — the branch's one-line
precedence flip plus `AV_PROD_ACCOUNT_ID` wiring (prod.ts, CI, new
`config.test.ts`) directly fixes this. Third, main's `LOG_EVENTS` union is
missing two event strings (`agent.run.spend_refunded`,
`agent.run.spend_refund_failed`) that are already logged in production code —
worth adding just those two lines. Everything else (the EMF-mixin logger
rewrite, the wholesale `runner.ts`/`events.ts` overwrites, the
egress-proxy-image deletion in CI) is stale-base noise or superseded, since
main already solves EMF metric emission more precisely via
`runOutcomeMetric()`.

---

## `origin/claude/pr-fix-n0b84h`

**Intent:** Single commit (`60fccb0`) on an old Phase-2 base fixes three
correctness bugs in `runner-sandbox.ts`'s sandbox launch path: (1) don't roll
back a live ECS task just because the follow-up `taskArn` patch fails, (2)
refund the spend reservation on _any_ `acquireGuard` failure (not just
`AgentRunInProgressError`), (3) zero `costUsd` in `onLaunchFailure` alongside
the refund. Adds two regression tests. Everything else on the branch is
stale Phase-2 base content already superseded by main.

| File                                      | Verdict         | What main lacks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/services/src/runner-sandbox.ts` | partially-novel | Fixes #1 and #3 are already on main, and main's version of #3 is materially better (atomic `claimRunReservation` guards a concurrent lifecycle-handler race the branch's naive version doesn't handle). **Fix #2 is not on main**: `acquireGuard` still only refunds when the guard-acquire failure is `instanceof AgentRunInProgressError`, leaking the spend estimate on any other failure (e.g. a DynamoDB throttle from `acquireActiveRun`, which can throw non-conditional-check errors). |
| `packages/services/src/runner.test.ts`    | partially-novel | The "taskArn patch fails" regression test duplicates coverage main already has. The "refunds the reservation when acquiring the slot fails unexpectedly" test has no equivalent on main and exercises the still-open bug above.                                                                                                                                                                                                                                                                |

**Worth landing:** one targeted fix. Change `acquireGuard` in
`packages/services/src/runner-sandbox.ts` to refund the spend reservation
unconditionally before rethrowing (not only on `AgentRunInProgressError`),
and port the accompanying "refunds the reservation when acquiring the slot
fails unexpectedly" test — main has no equivalent test and the leak is real
today.

---

## `claude/strange-bardeen-f92259`

**Intent:** Add explicit `appliesTo` constraints to the sandbox and web
stack `AwsSolutions-IAM5` `NagSuppressions`, so any _future_ over-broad IAM
statement stops synth-ing clean and silent.

| File                        | Verdict | What main lacks                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/infra/bin/app.ts` | novel   | Main's sandbox and web IAM5 suppressions have no `appliesTo` field at all (reason string only — a blanket suppression). Branch adds a 7-entry `appliesTo` for sandbox (S3 action wildcards, workspace-bucket ARN, `ecr:GetAuthorizationToken` `Resource::*`) and an 8-entry `appliesTo` for web (S3 actions, web/assets buckets, CloudFront invalidation), plus more accurate reason strings. |

**Worth landing:** all of it. This is a narrow, self-contained
security/correctness improvement main entirely lacks — replacing two blanket
IAM5 suppressions with precise resource/action enumerations so a genuinely
over-broad future statement can't hide behind them.

---

## M2 shopping list

Every novel or partially-novel item across all four branches, grouped by
subsystem. Each item names its source branch and file; the M2 pass should
port the fix, not the branch's full diff, per the caveats noted above.

### Auth / Google federation (blocks AC-3.3)

- `packages/infra/src/stacks/auth-stack.ts` — hosted-UI domain, conditional
  `UserPoolIdentityProviderGoogle` reading its client secret from Secrets
  Manager, conditional `SupportedIdentityProviders`. **Preserve the existing
  `CliClient`/`CfnOutput`** — the source branch deletes it, main's CLI login
  still needs it. — _`origin/claude/bug-fixes-test-pass-i5ctw3`_
- `packages/infra/src/stacks/auth-stack.test.ts` — new (adapt for `CliClient`
  kept alongside Google federation). — _same branch_
- `packages/infra/config/types.ts` — add `googleClientId?: string`,
  `oauthCallbackUrls?: readonly string[]` **alongside** the existing
  `sesSenderDomain` (do not delete it). — _same branch_
- `packages/infra/config/dev.ts` — `oauthCallbackUrls: ['http://localhost:5173']`.
  — _same branch_
- `docs/key-properties/user-auth.md` — document Google federation as wired;
  keep the `CliClient` enforcement-table row. — _same branch_
- `docs/phases/phase-1-mvp.md` — reword the Google-federation deviation
  bullet. — _same branch_
- `docs/playbooks/deploy-env.md` — add the `UserPoolDomain` post-deploy
  output bullet. — _same branch_

### Deploy / prod account pinning

- `packages/infra/config/index.ts` — precedence flip:
  `base.account ?? process.env['CDK_DEFAULT_ACCOUNT']`. —
  _`origin/claude/bug-fixes-test-pass-i5ctw3`_
- `packages/infra/config/prod.ts` — read `AV_PROD_ACCOUNT_ID` into
  `account`. — _same branch_
- `packages/infra/test/config.test.ts` — new: unknown-env rejection,
  `CDK_DEFAULT_ACCOUNT` fallback, prod-pinning precedence. — _same branch_
- `.github/workflows/deploy.yml` — wire `AV_PROD_ACCOUNT_ID` into the prod
  `CDK deploy` step's `env`. **Do not** remove the existing egress-proxy
  image build steps. — _same branch_
- `docs/key-properties/aws-account-and-region.md` — document that a
  config-pinned account now wins over `CDK_DEFAULT_ACCOUNT`. — _same branch_

### Observability

- `packages/shared/src/observability/events.ts` — add
  `'agent.run.spend_refunded'` and `'agent.run.spend_refund_failed'` to
  `LOG_EVENTS` (already logged in `runner.ts`, `runner-sandbox.ts`,
  `anthropic-gateway.ts`; just missing from the union). —
  _`origin/claude/bug-fixes-test-pass-i5ctw3`_

### Spend / concurrency correctness (touches AC-2.1–2.4)

- `packages/services/src/runner-sandbox.ts` — `acquireGuard`: refund the
  spend reservation on **any** `acquireGuard`/`acquireActiveRun` failure, not
  only `AgentRunInProgressError`. — _`origin/claude/pr-fix-n0b84h`_
- `packages/services/src/runner.test.ts` — port "refunds the reservation
  when acquiring the slot fails unexpectedly." — _same branch_

### IAM least-privilege

- `packages/infra/bin/app.ts` — land the full `appliesTo` diff for the
  sandbox and web `AwsSolutions-IAM5` suppressions as-is. —
  _`claude/strange-bardeen-f92259`_
