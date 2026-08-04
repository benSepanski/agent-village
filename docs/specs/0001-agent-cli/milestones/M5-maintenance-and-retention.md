# M5: Maintenance and retention

Spec: `../spec.md`
Status: Planned
Depends on: M4

## Slice

A wrapping that has rotted stops deciding instead of deciding wrongly, a policy that has rotted is
reported on, and the journal stays bounded with an adversary pushing on it. `agent-cli doctor`
re-introspects a `cli` target, diffs what it observes against the recipe's surface map, and
classifies the difference: a grammar change to a **policy-referenced** verb quarantines the wrap, so
every later invocation denies `recipe-drift` at exit 77 until an author re-locks and redeploys; an
added-upstream verb is informational and quarantines nothing; a target `doctor` cannot run is
`surface-unverifiable`, blocking in CI and quarantining nothing, because inability to introspect is
not evidence of change. **An `http` target has no surface to monitor** — it has no surface map, every
record it produces carries `surfaceDigest: null`, `doctor` has nothing to re-run, and the quarantine
mechanism never fires for it, so **G14 does not hold for an `http` target**; this milestone puts that
sentence in `doctor`'s own output rather than leaving a reader to assume both kinds are covered.
`agent-cli observe --since 7d` reads the journal, groups denials into candidate widenings and
permitted-but-never-invoked rules into candidate narrowings, writes a patch file, and applies
nothing. Retention drops whole UTC day-files oldest-first at 30 days or 2 GiB, whichever binds first,
and a pre-verdict flood coalesces into one counted `invocation.throttled` record instead of buying
eviction of the day-file it would otherwise age out.

## Out of scope

| Not here                                                                                    | Where it is instead                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The `ask` action, the brief, and every approver failure mode                                | [M6](M6-approver-and-spec-qa.md)                                                                                                                                                                 |
| A break-glass that lifts a quarantine without a re-lock                                     | Nowhere yet. Open question Q8 is unresolved, and neither the closed toolkit command list nor the closed audit event set has a member for it, so a break-glass is a spec amendment first          |
| Drift detection of any kind for an `http` target — no surface map, no `--relock`, no re-run | Nowhere, deliberately. The spec lists it under _Deliberately not guaranteed_: a provider changing a verb's grammar or its effect is undetected                                                   |
| Classifying a provider's body-level failure at HTTP 200 as drift                            | Nowhere. Parsing a response body is out under Scoping guidance, and Q15 carries the consequence                                                                                                  |
| Applying `observe`'s proposals                                                              | `observe` writes a patch file and nothing else. An author applies it through `check`, `test`, `diff` and `deploy` — [M3](M3-policies-and-gates.md), where CI fails an unexplained `deny → allow` |
| Rollups or summaries surviving a prune, and cross-instance journal reads                    | Nowhere. Both are non-goals: a pruned range is unavailable, and `journal --request` on a pruned id returns `pruned` with the range                                                               |
| Detecting a flag that keeps its name and changes meaning                                    | Nowhere. The only defences are the trials corpus and the effect classification, which the spec states rather than implies away                                                                   |
| Confining the auth process, and an egress allowlist generated from the deployed set         | Out of this spec — Q9 and Q13                                                                                                                                                                    |

## Acceptance criteria

| ID      | Criterion                                                                                                                                                                                                                                                                                                                                                                                           | Serves | Verified by                                                                                                                                                        |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-M5.1 | `doctor` puts every difference between a `cli` target and its surface map into exactly one class: a grammar change to a policy-referenced verb, an added-upstream verb, or an unrunnable target. A record carrying two classes, or a difference carrying none, is a defect                                                                                                                          | AC-6.1 | A fixture `cli` target with one help variant per class; assert `drift.detected`'s `class` and `verbs` per variant                                                  |
| AC-M5.2 | A grammar change to a policy-referenced verb quarantines the wrap: `wrap.quarantined` names `driftClass`, `verbs`, `lockedSurfaceDigest` and `observedSurfaceDigest`, the deployed set carries the flag, and the next invocation denies `recipe-drift` with decider `runtime`, exit 77, and a remedy saying plainly that this is not the agent's error                                              | AC-6.1 | The grammar-change variant, then one invocation of the quarantined wrap; compare the denial against the spec's canonical denial block field set                    |
| AC-M5.3 | Quarantine is narrow in both directions: an added-upstream verb emits `drift.detected` and no `wrap.quarantined`, an unrunnable target reports `surface-unverifiable` and no `wrap.quarantined`, a drifted verb no policy references quarantines nothing, and an invocation in flight when the flag is set runs to completion                                                                       | AC-6.1 | The remaining two variants, plus a fourth fixture whose drifted verb is absent from every deployed policy; a concurrency case setting the flag mid-execution       |
| AC-M5.4 | Repair is exactly `new recipe … --relock`, `diff --recipe`, `test`, `deploy`, and the wrap decides again only after `deploy` succeeds; re-locking without deploying changes no verdict                                                                                                                                                                                                              | AC-6.1 | Run the four steps against the quarantined fixture, invoking after each; assert `recipe.changed` at the re-lock and `wrap.deployed` at the deploy                  |
| AC-M5.5 | `doctor` over an `http` recipe re-runs nothing, emits no `drift.detected`, sets no quarantine flag, and says in its output that the recipe makes no checkable claim about its target's surface; every record that recipe produces carries `surfaceDigest: null`                                                                                                                                     | AC-6.1 | `doctor` against the shipped `http` recipe from [M4](M4-slack-http-target.md); a journal scan asserting `surfaceDigest` is null on every record naming that recipe |
| AC-M5.6 | `observe --since 7d` runs in both directions and applies nothing: repeated denials group into candidate widenings, permitted-but-never-invoked rules surface as candidate narrowings, a patch file is written, and no recipe, surface map, policy, wrap, trials file or deployed-set entry changes                                                                                                  | AC-6.2 | A synthetic 7-day journal containing one unused rule and one repeated denial; digest every artifact on disk and in the deployed set before and after               |
| AC-M5.7 | `observe` reads only its own auth process's journal and refuses a request id or session outside the caller's instance, and its proposals cite only what the journal holds — no `redact` value, no `sensitive` value, no credential material                                                                                                                                                         | AC-4.4 | A two-instance fixture journal; a scan of the patch file against the run's seeded credential-shaped, `redact` and `sensitive` values                               |
| AC-M5.8 | Retention binds on both axes with whole day-files: driving one journal past 30 days and another past 2 GiB each drops files oldest-first and never partially, every remaining line parses, `audit.pruned` names `rangeStart`, `rangeEnd`, `filesDropped`, `bytesFreed` and which `boundHit`, and `journal --request` on a pruned id returns `pruned` with the dropped range rather than "not found" | AC-4.3 | Two seeded journals, one per bound; `ls` and a line-parse pass before and after; one `journal --request` against a pruned id                                       |
| AC-M5.9 | Flooding cannot buy eviction: pre-verdict attempts from one principal above the accept rate coalesce into `invocation.throttled` carrying `windowSeconds`, `attempts` and `firstReason`, one record per window rather than one per attempt, and the flood's total bytes stay below what would age out the oldest day-file                                                                           | AC-4.3 | A flood harness at 100× the accept rate for one window, with byte accounting against the size bound (G16)                                                          |

## Audit surface

Per [ADR-0003](../../../adr/0003-auditability-is-a-requirement.md), and drawn only from the spec's
closed event set.

| Event                  | Env | Why this milestone has it                                                                                               |
| ---------------------- | --- | ----------------------------------------------------------------------------------------------------------------------- |
| `drift.detected`       | A   | `doctor` finds the installed target differs from the map: `recipe`, `class`, `verbs`, `referencedByPolicies`            |
| `wrap.quarantined`     | A   | The drift is on a policy-referenced verb: `wrap`, `driftClass`, `verbs`, `lockedSurfaceDigest`, `observedSurfaceDigest` |
| `verdict.denied`       | R   | Every invocation of a quarantined wrap, reason `recipe-drift`, decider `runtime`, with the `remedy`                     |
| `recipe.changed`       | A   | `check` accepts the re-locked recipe digest during repair                                                               |
| `wrap.deployed`        | A   | The redeploy that lifts the quarantine, so the interval a wrap spent quarantined is bounded by two records              |
| `audit.pruned`         | P   | Retention drops day-files at either bound: `rangeStart`, `rangeEnd`, `filesDropped`, `bytesFreed`, `boundHit`           |
| `invocation.throttled` | R   | Pre-verdict attempts from one principal exceed the accept rate: `windowSeconds`, `attempts`, `firstReason`              |

**On whose behalf.** `drift.detected`, `wrap.quarantined`, `recipe.changed` and `wrap.deployed` carry
`actor = {osUser, gitAuthor}` and `gitCommit`, because `doctor` and `deploy` are author actions and
the accountable party is a person. `verdict.denied` and `invocation.throttled` carry
`principal = {app, instance, session, wrap}`, derived from the accepting socket's path and from
nothing the sandbox asserts — see
[ADR-0005](../../../adr/0005-socket-derived-principal-and-grant-layout.md). `audit.pruned` carries
neither, because retention is the auth process acting on its own storage.

**Correlation.** `requestId` per denied invocation; `seq` monotonic per journal;
`policyDigest`/`recipeDigest`/`surfaceDigest` on every request-scope record, with `surfaceDigest`
null for the `http` recipe; `lockedSurfaceDigest` and `observedSurfaceDigest` on `wrap.quarantined`,
which are what let an operator say which map broke and against what. `audit.pruned`'s range plus
`authd.started`/`authd.stopped` keep an absence explicable: a gap is either pruned, or the process
was not accepting, and the records say which.

**Destination and retention.** Unchanged and re-asserted here because this is the milestone that
enforces it: append-only JSONL, one file per UTC day, one journal per auth process, under that
process's own directory, outside the workspace and every grant directory, readable by the owner of
that auth process. **30 days or 2 GiB, whichever binds first**, dropping whole day-files oldest-first.

**Never recorded.** No byte of the help output `doctor` walked beyond verb names, the drift class and
the two surface digests. No `redact` or `sensitive` value in an `observe` proposal or a patch file —
the journal never held them, so a proposal can only be as specific as the record. No credential
material, in any form, including its length. **And, stated rather than assumed: a read of the journal
is not itself an event.** The closed set has no member for one, so an `observe` or `journal` run
leaves no record of who read what. That is a property of the closed set, not an omission this
milestone may fix — adding a read event is an amendment to the spec.

## Approach

Order the work so the riskiest classification lands first and the storage work cannot be skipped.

1. **Surface comparison.** Re-introspect a `cli` target with the same walker the recipe was scaffolded
   with, and diff against `recipes/<r>.surface.json`. Classification is a function of that diff plus
   the deployed policies, since "policy-referenced" is a property of the policy set, not of the recipe.
2. **Quarantine.** A flag in the deployed set, written by `doctor`, read on the decision path before
   normalization. In-flight invocations are unaffected; the next one denies. The flag clears only
   through `deploy`.
3. **The `http` arm.** One branch that reports the absence of a surface map as a fact about the recipe
   kind. It emits nothing, because emitting `drift.detected` with a null class would read as evidence a
   check ran.
4. **`observe`.** A journal reader over one instance, grouping by verb and reason for widenings and by
   rule id for never-invoked narrowings. It writes one patch file and touches nothing else.
5. **Retention and the throttle.** Prune whole closed day-files only — never the file currently being
   appended to — and count pre-verdict attempts per principal before the journal write, so the
   coalescing happens ahead of the storage it protects.

**What could go wrong.** Introspection that is not normalized (terminal width, locale, a pager)
diffs as drift and quarantines a healthy wrap — which is exactly the path by which a safety mechanism
gets switched off, and therefore how Q8 stops being theoretical. A prune racing an append truncates a
record mid-JSON, which the whole-day-file rule exists to prevent and which the verification re-parses
every remaining line to catch. A throttle set too aggressively coalesces the repeated denials that
Flow 2 calls `observe`'s raw material, so AC-4.3 and AC-6.2 pull against each other at exactly one
number.

## Decisions needed

**Q8 — the quarantine blast radius, and whether an audited break-glass exists.** This is the milestone
that makes quarantine real, so this is where the question stops being cheap. One upstream release can
quarantine every wrap over a recipe across every application at once, and a safety mechanism that
takes several applications down on a Tuesday gets disabled — which is worse than not having it, and
would make G14 a claim nobody operates. The owner decides whether an explicit, audited, owner-signed
drift acceptance exists, whether it is per-wrap or per-recipe, and whether it expires. **Either answer
costs something specific here:** "no" leaves the pressure valve as the recipe's pinned
`target.version` on the auth host and nothing else; "yes" needs a member of the closed audit event set
that does not exist, and a way to invoke it that the closed toolkit command list does not contain, so
it is a spec amendment before it is work in this milestone. It warrants an ADR either way, because it
decides whether G14 is a guarantee or an advisory.

**The per-principal accept rate, and what counts against it.** The spec fixes the mechanism —
coalescing into `invocation.throttled` — and not the number or its scope. Two things must be settled
before AC-M5.9 can pass or fail: the rate and window, and whether an attempt that reaches a verdict
counts against the same rate. The spec says "pre-verdict rejections" in G16 and "pre-verdict attempts"
in the event table, while Flow 2 says a retried denial is recorded each time and is `observe`'s raw
material — so a reading that counts denied-with-a-verdict attempts against the accept rate deletes
`observe`'s input to buy retention headroom. The number is a milestone decision recorded in this
milestone's QA doc; the scope is not, because it changes what appears in the journal, which the spec
says is an amendment rather than a milestone decision.

**Whether `doctor`'s introspection is normalized before diffing.** Nothing in the spec requires it,
and an unnormalized diff produces false drift. Recorded in this milestone's QA doc as a `doctor` rule;
it needs an ADR only if the answer is to weaken quarantine to a warning, which changes G14.

## Verification

A QA pass reproduces this without reading the implementation. Evidence lands in
[the spec's QA directory](../qa/README.md), per
[qa-a-milestone](../../../dev/workflows/qa-a-milestone.md).

**Fixtures, built first.**

- A `cli` fixture target with four help variants: (a) a policy-referenced verb whose flag grammar
  moved, (b) one added verb, (c) a binary exiting non-zero on `--help`, (d) a drifted verb no
  deployed policy references.
- Two seeded journals: one whose oldest day-file is 31 days old, one whose day-files total just over
  2 GiB.
- One synthetic 7-day journal holding one repeated denial and one rule that is permitted and never
  invoked, plus records from a second instance.

**Drift and quarantine.**

```bash
agent-cli doctor                       # once per help variant (a)-(d)
```

`drift.detected` and `wrap.quarantined` carry an actor rather than a principal, and the spec's
`journal` selectors are `--session` and `--request`, so read those two records from the auth
process's current UTC day-file, which is append-only JSONL.

Look for: exactly one `drift.detected` per run with one `class`; `wrap.quarantined` only for variant
(a); `surface-unverifiable` reported for (c) with no quarantine; nothing quarantined for (d). Then
invoke the wrap and look for the denial block with `reason: recipe-drift`, exit 77, and a remedy
naming that this is not the agent's error. Capture: the four `doctor` outputs, the journal lines, and
the deployed-set flag file listing.

**Repair.**

```bash
agent-cli new recipe <fixture> --relock
agent-cli diff --recipe <fixture>
agent-cli test
agent-cli deploy
```

Invoke the wrap after each of the four steps. Look for: `recipe-drift` still denying after the first
three, deciding normally after the fourth, `recipe.changed` at the re-lock and `wrap.deployed` at the
deploy. Capture: the four invocation exits and the two authoring records.

**The `http` arm.**

```bash
agent-cli doctor                       # deployed set containing the http recipe only
```

Look for: no `drift.detected`, no `wrap.quarantined`, and output stating that the recipe makes no
checkable claim about its target's surface. Capture: the output, and a grep of the journal showing
`surfaceDigest: null` on every record naming that recipe.

**Review.**

```bash
agent-cli observe --since 7d
```

Look for: one candidate widening from the repeated denial, one candidate narrowing from the unused
rule, one patch file, and byte-identical artifacts and deployed set afterwards. Then run `observe`
against a request id from the second instance and look for a denial to read it. Capture: digests of
every artifact before and after, the patch file, and a scan of the patch file for the run's seeded
`redact` and `sensitive` values.

**Retention and flooding.**

```bash
agent-cli journal --request req_…      # an id inside the pruned range
```

Drive each seeded journal past its bound. Look for: whole day-files gone oldest-first, no partial
file, every remaining line parsing as JSON, `audit.pruned` naming the range and the `boundHit`, and
`pruned` with the dropped range from `journal --request`. Then run the flood harness for one window
and look for one `invocation.throttled` per window carrying `attempts`, not one record per attempt.
Capture: `ls` before and after each prune, the `audit.pruned` records, the flood's record count and
byte total.

**Finally.**

```bash
pnpm check
```
