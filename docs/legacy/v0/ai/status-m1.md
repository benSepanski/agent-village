# M1 status — definition + reconciliation

M1 per the [milestone plan](1.0-definition.md#milestone-plan-criteria-mapped):
"Definition + reconciliation." **Complete.**

## What M1 produced

- [1.0-definition.md](1.0-definition.md) — the binding 1.0 scope: testable
  acceptance criteria (`AC-<item>.<n>`) per bar area, the milestone plan, and
  the explicitly-out-of-scope list.
- [branch-reconciliation.md](branch-reconciliation.md) — content-level
  reconciliation of the four outstanding `claude/*` fix branches against
  `origin/main` (`628a6a1`), ending in a consolidated **M2 shopping list**.
- Two stale-doc fixes found while reconciling, corrected in place (not new
  docs, so noted here rather than in the reconciliation doc):
  - [architecture/cost-guards.md](../architecture/cost-guards.md) said the
    `runs.spend_limit_exceeded` alarm was "currently inert" pending EMF
    emission. EMF emission (`runOutcomeMetric`, emitted at the
    reservation-rejection/terminal-outcome sites in `runner-sandbox.ts`,
    `runner.ts`, and `sandbox-lifecycle.ts`, and consumed by the alarm
    `monitoring-stack.ts` defines) already shipped on main — the doc now
    says so.
  - [notes/2026-07-18-production-readiness-audit.md](../notes/2026-07-18-production-readiness-audit.md)'s
    lead paragraph still read as if 7 of the 14 audit findings were open. All
    14 are closed (7 in the original pass, the remaining 7 in the PR #25
    follow-up); the note's wording now says so while keeping the original
    deferred-fix sketches for provenance, per the note's own intent.

## Headline recon findings

- **Phase 3, 4, and 5 are already fully merged.** The
  `phase-3-application-platform` branch has zero content main lacks — every
  commit landed via squash merge or an explicit tail cherry-pick
  (`df6d495`), and main's subsequent audit passes hardened the same
  subsystems further. No cherry-pick work remains for that branch.
- **Google OAuth federation for Cognito is genuinely missing from main** —
  only a TODO comment exists today. `origin/claude/bug-fixes-test-pass-i5ctw3`
  has real, novel `auth-stack.ts`/`config` work for it, directly feeding
  **AC-3.3** (account management), but it also deletes the `CliClient` main's
  `village login` depends on — that deletion must not travel with the port.
- **Prod account-pinning is a real, narrow, verifiable bug on main**:
  `EnvConfig.account` exists in the type, but `loadEnvConfig()` always lets
  the ambient `CDK_DEFAULT_ACCOUNT` win, and `prod.ts` never sets `account`
  in the first place — so pinning is currently a no-op. The same branch has
  the one-line fix.
- **A narrow spend-leak bug survives on main**: `acquireGuard` in
  `runner-sandbox.ts` only refunds a spend reservation on
  `AgentRunInProgressError`, not on other `acquireActiveRun` failures (e.g. a
  DynamoDB throttle) — `origin/claude/pr-fix-n0b84h` has the one-line fix and
  a regression test main lacks. Relevant to **AC-2.1–2.4**.
- **A real, self-contained IAM hardening item** — `claude/strange-bardeen-f92259`
  adds precise `appliesTo` scoping to two blanket `AwsSolutions-IAM5`
  suppressions main still has wide open.
- Everything else across all four branches is `already-merged`,
  `superseded-by-main` (main solves it better), or `stale-base-noise` (the
  branch predates work main has since done) — see the full verdict tables in
  [branch-reconciliation.md](branch-reconciliation.md).

## What M2 should pick up

Start from the
[M2 shopping list](branch-reconciliation.md#m2-shopping-list) in
branch-reconciliation.md — it's grouped by subsystem (auth/Google
federation, deploy/account pinning, observability, spend/concurrency
correctness, IAM least-privilege) with each item's source branch and file.
Per [1.0-definition.md](1.0-definition.md#milestone-plan-criteria-mapped),
M2 delivers **AC-1.1** and **AC-1.3** (audit primitives verified on a single
trunk); the shopping list's auth and account-pinning items also directly
unblock M3/M4 acceptance criteria (**AC-3.3**, **AC-2** family), so landing
them now avoids re-deriving the same fixes later. No milestone after M2
should start against un-reconciled branches — once the shopping list is
landed (or explicitly rejected item-by-item), the four `claude/*` branches
can be deleted.
