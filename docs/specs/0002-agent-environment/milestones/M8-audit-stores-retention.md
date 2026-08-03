# M8: Audit stores, retention, and reconstruction

Spec: `../spec.md`
Status: Planned
Depends on: M7

## Slice

The audit surface becomes whole. The content store exists as a separately permissioned store
holding the bodies crossings decided on, joined to the journal by digest, emitting `content.read`
on every read. Every retention class enforces its bound with the spec's defined at-the-bound
behaviour: journal rows drop at age bounds, oldest flows collapse to `flow.summary` at the size
bound (active flow last), pre-auth counters aggregate to daily totals, content bodies expire
leaving provable digests, and a mediated-volume write crossing survives as long as the version it
created — state and provenance expire together. An auditor holding one flow identifier recovers
the admission, every crossing, every verdict and reason, and each decision's basis, without
guessing — executed and recorded as a walkthrough, not asserted. A lint over emitted events
enforces the closed event-name set, and a grep over a full fixture run proves no credential,
`model.infer` body plaintext, or per-file read appears in either store.

## Out of scope

- Cross-user enforcement and cloud storage of the stores — agent-server's, per the spec.
- The multi-week campaign narrative ("why did you apply to Stripe?") — M9; M8 proves the
  clock-advanced mechanics it depends on.
- A real `model.infer` call — the fixture plants a body shaped like one (digest, byte count, token
  counts recorded; plaintext not) so AC-M8.5's grep has a real target without a provider account.

## Acceptance criteria

| ID      | Criterion                                                                                                                                                                                              | Serves | Verified by                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------- |
| AC-M8.1 | Given one flow identifier, the admission, every crossing, every verdict and reason, and each decision's basis are recoverable without guessing                                                         | AC-4.1 | Reconstruction walkthrough, executed and recorded |
| AC-M8.2 | A fact written to a mediated volume in flow 1 and read in flow 2 after the general journal bound has elapsed is still explainable: the planting crossing and its body survive because the version does | AC-4.2 | Clock-advanced run over a fixture                 |
| AC-M8.3 | No event name outside the declared closed set appears in the journal, enforced by a lint that fails on an unknown name                                                                                 | AC-4.4 | Lint over emitted events, wired into `pnpm check` |
| AC-M8.4 | At the journal size bound the oldest flow's rows collapse to one `flow.summary` with counts by event name and verdict and first/last timestamps; the active flow collapses last                        | AC-4.2 | Journal inspection at a forced size bound         |
| AC-M8.5 | No credential, `model.infer` body plaintext, or per-file read appears anywhere in the journal or content store                                                                                         | AC-4.5 | Grep over a full fixture run                      |
| AC-M8.6 | Reading a content-store body emits `content.read`; a body past its request type's declared bound is deleted while its digest remains in the journal and the crossing stays provable                    | AC-4.5 | Clock-advanced run plus journal inspection        |

## Audit surface

This milestone is the audit surface's own completion. Events: `content.stored`, `content.read`,
`flow.summary`. Stores: journal (envelopes, verdicts, reasons, deciders, digests; platform-written;
owner-read) and content store (bodies by digest; separate grant; `content.read` on every read).
Retention: all four classes of the spec's table, enforced with defined at-the-bound behaviour.
Never recorded: the spec's full "deliberately not recorded" list, now mechanically checked by
AC-M8.5's grep and AC-M8.3's lint.

## Approach

Retention needs a controllable clock — the platform takes its time source as an injectable
dependency so clock-advanced runs are runs, not simulations of runs. The event-name lint reads the
closed set from one declaration shared with the emitters, so the set cannot fork. The
reconstruction walkthrough is a documented procedure (queries and expected joins) executed against
a fixture journal and captured as QA evidence — it becomes the auditor's manual. What could go
wrong: expire-together (AC-M8.2/M8.6) depends on M5's version layout supporting deletion and on
bounds being evaluated against the same clock; flow collapse must be idempotent under repeated
size pressure.

## Decisions needed

- Store formats (journal rows, content addressing) harden here into things M9's fixtures and any
  future `agent-server` will read — worth an ADR if the format is expensive to change later;
  decide when the shape is visible.

## Verification

1. `pnpm check` — green, now including the event-name lint (AC-M8.3 — verify it fails on a planted
   unknown name, then remove the plant).
2. Run the full fixture (ingress → crossings → mediated write → egress). Execute the
   reconstruction walkthrough from the flow id; capture every step (AC-M8.1).
3. Clock-advance past the general journal bound but within the volume's version-retention bound;
   confirm the planting crossing and body survive and the flow-2 read's derivation is
   reconstructable (AC-M8.2).
4. Force the journal size bound; confirm oldest-flow collapse to `flow.summary`, active flow last
   (AC-M8.4).
5. Read a content body; confirm `content.read`. Clock-advance past its bound; confirm deletion,
   surviving digest (AC-M8.6).
6. Grep journal and content store for planted credential markers, `model.infer` plaintext, and
   per-file read records (AC-M8.5).
