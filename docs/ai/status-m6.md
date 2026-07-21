# M6 status — local dogfood + verdict

M6 per the [milestone plan](1.0-definition.md#milestone-plan-criteria-mapped):
**AC-1.2, AC-1.4, AC-3.2, AC-5.5, AC-7.1–7.4** (local, browser-driven persona
dogfood + the written go/no-go verdict). Complete — with real findings.

## What the dogfood exercised

Five distinct personas drove the stack left up by the bring-up agent
(`pnpm local:up` + `pnpm dev`: LocalStack, DynamoDB Local, Vite SPA):

- **platform-operator** — brought the local stack up; mapped exactly what `pnpm dev` starts.
- **operator** — browser sign-in, CLI `agents`/`budget`/`admin`, docs walkthrough.
- **app-builder** — followed only `app-development.md`/recipes from a scratch fixture repo.
- **spend-limit-victim** — probed every spend wall (agent cap, user budget) and its transparency.
- **auditor** — tried to reconstruct one run's full story from the system's own trails.

## Headline findings

**The load-bearing finding (good to know, expected):** the local stack has **no
API server, no runner, and no local Cognito** — `pnpm dev` starts only the Vite
SPA. So no run/agent/user/spend record was ever created locally (auditor: full
DynamoDB scan → `Count: 0`), and no human/agent can get past sign-in (the
mock-auth seam is Playwright-only). Every "manual-dogfood against live behavior"
AC (1.2, 1.4, 2.6, 2.7, 3.2, 7.1, 7.3) is therefore **structurally unverifiable
locally** and legitimately moves to the M7 dev deploy. Not a broken mechanism —
a missing local execution layer, out of scope to build.

**Good:** spend enforcement is the strongest evidence — atomic dual-cap
`TransactWrite`, deterministic "agent cap wins" tie-break, monthly rollover, and
drift reconciliation, all re-run green (spend-tx/budget/runner-spend suites, 96+
tests). Extensibility (config injection + apply-bot fixture synth) and
connectivity (all three recipes, allow + deny) pass and were re-exercised. Cold-
start doc-following (AC-5.5) is byte-for-byte accurate through first AWS contact.

**Bad — real defects filed:**

- **Finding E (HIGH):** the SPA has **no mutation error handling anywhere** — a
  spend/budget 402 rejection is silently swallowed; the user sees nothing. Fails
  the binding "walls must be transparent" bar. Backend is correct; frontend never
  renders it.
- **Finding C (MED):** budget/limit schemas accept `Infinity` (round-trips to
  `null`, breaks DynamoDB marshalling); no upper bound.
- **Finding F (MED):** zero E2E coverage of the spend-transparency UI despite
  mock fixtures existing — the M3 transparency feature is untested at the UI.
- Plus: rendered sign-in screen shows only "Sign in with Google" (email/password
  form absent — AC-3.4 risk), silent CLI `login` on piped stdin, `local:up`
  healthcheck race, and misc CLI-UX/doc gaps.

## Verdict

**ready-for-dev-deploy** — nothing found blocks standing up the M7 dev
environment, and that deploy is the only surface where the 8 NEEDS-LIVE criteria
can be verified. **Caveat:** Finding E should be fixed before 1.0 signoff (ideally
pre-M7), or the live dogfood will simply re-flag it.

Tally: 14 PASS · 7 PARTIAL · 2 FAIL · 8 NEEDS-LIVE.

## Evidence & full verdict

- Persona logs: `m6-evidence/{platform-operator,operator,app-builder,spend-limit-victim,auditor}.md` (M6 scratchpad).
- Full per-AC scorecard, reasoning, and prioritized punch list: [`1.0-verdict.md`](1.0-verdict.md).

## Next: M7

User-gated dev-AWS deploy + live persona dogfood, preceded by a cost-control
briefing (AC-7.5). Recommended pre-M7 fixes first: Finding E, Finding C,
Finding F.
