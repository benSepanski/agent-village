# M6: The model approver, and QA of the whole spec

Spec: `../spec.md`
Status: Planned
Depends on: M5

## Slice

A rule whose action is `ask` consults a model, **inside a destination the program has already
bounded**, and the model can only narrow. The brief carries the verb, the effect, the policy's
`intent`, the rule's question, and only the argument values the rule marked showable — and no
free-form string authored by anyone but the policy author. Every failure mode denies with its own
reason code: unavailable, timed out, rate-limited, off-schema. An approver rewired to allow everything
produces the same verdict set as one rewired to deny everything, on every trial in the corpus, because
`check` has already refused any policy in which a model is the only thing constraining where an
irreversible effect lands.

Then the spec itself is QA'd against every criterion, per
[qa-a-spec](../../../dev/workflows/qa-a-spec.md), and the outcome is reported to the owner with a
question about what comes next — per [AGENTS.md](../../../../AGENTS.md), an agent does not choose the
next spec.

## Out of scope

| Not here                                                                   | Why                                                                                                         |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| A third verdict escalating to a human                                      | Open question Q4. It would change the verdict enum and the closed event set, both binding on acceptance     |
| Letting the approver widen a program decision                              | Not ever. The intersection is the mechanism, not a policy                                                   |
| Showing the approver target output, raw argv, or a prior denial's `detail` | Not ever — every one is a sandbox-authored injection channel                                                |
| Pinning approver verdicts, brief digests, or drift detection on briefs     | Deleted by design: a trial asserts **routing**, which is deterministic, so none of that apparatus is needed |

**If the owner resolves open question Q6 by taking the approver out of this spec entirely, M6 becomes
the spec QA pass alone and nothing else moves.** That is the whole reason it is last.

## Acceptance criteria

| ID      | Criterion                                                                                                                                               | Serves | Verified by                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| AC-M6.1 | An always-allow approver produces a verdict set identical to a deny-only approver's, on every trial in the corpus                                       | AC-3.2 | Approver substitution across the whole corpus, diffed verdict by verdict                                   |
| AC-M6.2 | Unavailable, timeout, rate-limited and off-schema each deny with a distinct reason code, decider `runtime`                                              | AC-3.2 | Fault injection, one case per mode                                                                         |
| AC-M6.3 | A canary string emitted by a probe target never appears in any brief                                                                                    | AC-3.3 | Probe target plus brief capture                                                                            |
| AC-M6.4 | The brief contains no string authored by a sandbox, including a prior denial's `detail`                                                                 | AC-3.3 | A two-turn scenario planting an instruction in a residual token, asserting its absence from the next brief |
| AC-M6.5 | `ask` is reachable only from a matched rule, and the result is intersected with the program's decision — a model allow over a program deny stays denied | AC-3.2 | Seeded rule fixtures per combination                                                                       |
| AC-M6.6 | In-sandbox explain never consults the approver: a matched `ask` returns `would: ask` with its rule id, and explain carries its own budget               | AC-5.3 | An explain-only session producing zero `approver.consulted`; budget exhaustion at the explain bound        |
| AC-M6.7 | Every spec criterion AC-1.1 … AC-7.4 is verified or explicitly recorded as unmet, with evidence                                                         | all    | The spec QA document                                                                                       |

## Audit surface

**Adds:** `approver.consulted` and `approver.failed`. These complete the closed set — nothing after
this milestone introduces an event name.

`approver.consulted` carries the question, verb, effect, model, latency, `returnedVerdict`,
`returnedReason`, and `shownFields[]` with a **per-field byte count and digest**. That last field is
deliberate and load-bearing: it is what makes the volume of data leaving for a third-party provider
reconstructable after the fact, which is the honest half of open question Q11.

**Principal and correlation:** unchanged. An `approver.consulted` and its `verdict.*` share a
`requestId`, so a consultation is never orphaned from the decision it informed.

**Never recorded:** the model's reasoning beyond its returned `reason` — the response schema has three
fields and anything else is discarded before typing. Values of `sensitive` fields reach the brief but
appear in the journal only as a digest and a length; the two paths take different types, so this is a
type-level fact rather than a filter.

**The honest note this milestone must write down:** a `sensitive` value shown to the approver **leaves
to a third-party provider, including on a request that is then denied**. "We do not log it" and "it
does not leave" are different claims, and the spec makes only the first.

## Approach

Build the brief constructor before the transport. It is the component with the security property, and
the transport is one POST already governed by R13 — the approver call is an `http` rendering like any
other, subject to origin validation, redirect refusal and the response cap.

The intersection is the whole design: the model's answer is combined with the program's, and a verdict
value is constructible only inside the decision module, enforced by a lint. That is what makes AC-M6.1
possible — if an always-allow approver could change any verdict, the program was not already bounding
the decision, and `check` should have refused that policy in M3.

What could go wrong:

- **The brief grows a convenience field.** Every field added to a brief is a potential injection
  channel, and the pressure to add "just the error text" or "the last denial" will be real. Both are
  sandbox-authored. AC-M6.4 is the guard.
- **Nondeterminism leaking into the trials corpus.** A trial must assert routing, never the model's
  answer. If a trial ever calls a model, the suite stops being reproducible and `test` stops being
  offline.
- **Treating an approver failure as a soft failure.** Every mode denies. Fail-closed includes failing
  closed on the component that was supposed to be the flexible one.

## Decisions needed

- **Open question Q6** — is the approver in this spec at all? — should be resolved before this
  milestone starts, because the answer either builds it or deletes it. The design is complete and safe
  without it: every destination is program-constrained by schema, so `ask` only narrows.
- **Open question Q11** — is it acceptable that a value we refuse to store locally leaves to a
  third-party provider, including on a denied request? G12's honesty depends on the answer: either
  provider zero-retention becomes a stated assumption in the guarantee, or `ask` is restricted to
  wraps whose content is already ours, or the residue is accepted and written down.
- **Open question Q4** — a third verdict escalating to a human — is worth revisiting once `ask` is
  real, because this is the milestone that shows what "the model was unsure" actually looks like in
  practice.

## Verification

```bash
pnpm check
agent-cli check && agent-cli test && agent-cli deploy
```

1. **Substitution.** Run the entire trials corpus twice: once against an approver stubbed to allow
   everything, once against one stubbed to deny everything. Diff the two verdict sets. Assert they are
   identical. Evidence: both sets and the empty diff. **A non-empty diff means a policy shipped in
   which the model was the only constraint, and M3's `check` gate has a hole.**
2. **Failure modes.** Inject each of unavailable, timeout, rate-limited, and off-schema. Assert a deny
   per case, each with a distinct reason code and decider `runtime`. Evidence: the four records.
3. **Blindness.** Run a probe target that emits a canary string on stdout, then trigger an `ask` on a
   subsequent invocation. Assert the canary appears in no brief. Then run the two-turn scenario: plant
   an instruction in a residual token so it lands in a denial's `detail`, invoke again, capture the
   brief, assert the instruction is absent.
4. **Intersection.** For each combination of program verdict and model answer, seed a rule and assert
   the outcome. A model allow over a program deny must stay denied.
5. **Explain.** Run an explain-only session against a policy containing `ask` rules. Assert zero
   `approver.consulted`, and that each matched `ask` returns `would: ask` with its rule id. Exhaust the
   explain budget and assert it denies at a bound an order of magnitude below the wrap's.
6. **Egress accounting.** From `approver.consulted` records alone, reconstruct the total bytes sent to
   the provider across a session, per field. Evidence for Q11.
7. **Spec QA.** Follow [qa-a-spec](../../../dev/workflows/qa-a-spec.md). Walk every criterion AC-1.1
   through AC-7.4, record verified or unmet with evidence, and write the result to
   `../qa/spec-<date>.md`. Then report the outcome to the owner and **ask what the next spec should
   be** — do not choose one.
