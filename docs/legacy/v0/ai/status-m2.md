# M2 status

M2 consolidated the four genuinely-novel items identified by the M1 branch
reconciliation (PR https://github.com/benSepanski/agent-village/pull/27) —
the ones worth carrying forward from a set of old unmerged branches that had
otherwise diverged or gone stale.

## What landed

1. **Google IdP federation in auth-stack** ([`auth-stack.ts`](../../packages/infra/src/stacks/auth-stack.ts)) —
   conditional on a `googleClientId` config value. When it is absent, the
   stack behaves exactly as before: `COGNITO`-only sign-in. The `CliClient`
   app client and its `CfnOutput` were preserved unchanged.
2. **Prod account pinning** — the config-declared account now wins over
   `CDK_DEFAULT_ACCOUNT`, and prod specifically reads `AV_PROD_ACCOUNT_ID`
   ([`packages/infra/config/prod.ts`](../../packages/infra/config/prod.ts)).
   CI is wired to set it, and config tests were added
   ([`packages/infra/test/config.test.ts`](../../packages/infra/test/config.test.ts)).
3. **Spend-reservation refund made unconditional** on run-guard acquire
   failure. Previously the reservation could leak — a run-guard acquire
   failure (e.g. a DynamoDB throttle) left the earlier cost reservation
   claimed with nothing to release it. Regression tests were added alongside
   the fix.
4. **`AwsSolutions-IAM5` nag suppressions scoped with `appliesTo` arrays**,
   replacing blanket suppressions. Adversarial verification of this change
   caught a second bug: an account-interpolation issue where a hardcoded
   `<AWS::AccountId>` token stopped matching once a concrete account was
   pinned by item 2 above, which broke synth. Fixed by interpolating
   `config.account` with a token fallback.

## Doc corrections

Two doc claims about EMF metrics were stale and are now corrected:

- [`docs/architecture/observability.md`](../architecture/observability.md) —
  terminal run outcomes emit the CloudWatch EMF envelope via
  `runOutcomeMetric`, so the `AgentVillage`-namespace alarms
  (`runs.error`, `runs.spend_limit_exceeded`) are active, not inert.
- [`docs/phases/phase-1-mvp.md`](../phases/phase-1-mvp.md) — the stale
  "alarms are inert" bullet was removed.

## Branch cleanup

Per the M1 reconciliation (PR https://github.com/benSepanski/agent-village/pull/27),
everything else in the old unmerged branches was already superseded or
redundant. Once PR https://github.com/benSepanski/agent-village/pull/28
(which lands this M2 consolidation) merges, the following branches contain
nothing novel and are safe to delete pending owner OK:

- `phase-3-application-platform`
- `claude/next-stage-implementation-a74d80`
- `claude/agent-village-app-ready-8a2326`
- `claude/bug-fixes-test-pass-i5ctw3`
- `claude/pr-fix-n0b84h`
- `claude/strange-bardeen-f92259`
