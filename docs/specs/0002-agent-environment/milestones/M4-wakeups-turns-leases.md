# M4: Wakeups, turns, and the write lease

Spec: `../spec.md`
Status: Planned
Depends on: M3

## Slice

A wakeup delivered into a running environment starts or resumes a turn, and the per-volume write
lease serialises turns that write: two wakeups arriving 100 ms apart at one writer environment
produce two turns in sequence, the second's `wakeup.queued`, with no overlapping lease. Writes
after lease expiry fail. A wakeup arriving at a full queue is dropped with a recorded reason, never
silently coalesced. An interactive environment receives a wakeup mid-turn and resumes without the
environment restarting. This milestone also produces the first evidence on the spec's open question
about lease latency: a measured queue delay for a check-in behind a long sweep-shaped turn.

## Out of scope

- Ingress bridges as wakeup sources — M6. Here wakeups come from a test scheduler on the platform
  side, which the spec permits ("raised by a bridge or by an external scheduler").
- The DM fixture — M9. AC-5.2 is verified here against a loopback fixture and re-verified there
  against the real DM topology.
- Preemption or priority between queued wakeups — the spec has no such rule; if the latency
  evidence says it needs one, that is a spec amendment to propose, not a thing to build.

## Acceptance criteria

| ID      | Criterion                                                                                                                                        | Serves | Verified by                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------- |
| AC-M4.1 | Two wakeups 100 ms apart into one writer environment produce two turns in sequence, with `wakeup.queued` for the second and no overlapping lease | AC-2.3 | Journal inspection                    |
| AC-M4.2 | A write attempted after the turn's lease has expired fails, and `volume.lease.denied` is recorded                                                | AC-2.3 | Journal inspection plus write attempt |
| AC-M4.3 | An interactive environment receives a wakeup mid-turn and resumes without the environment restarting                                             | AC-5.2 | Journal inspection, loopback fixture  |
| AC-M4.4 | A wakeup arriving at an environment at its declared queue bound emits `wakeup.dropped` with a reason                                             | AC-2.3 | Journal inspection                    |
| AC-M4.5 | Queue latency for a wakeup behind a lease-holding turn of configurable length is measured and recorded in this milestone's QA evidence           | AC-2.3 | Timed fixture run, evidence captured  |

## Audit surface

Events: `wakeup.delivered`, `wakeup.queued`, `wakeup.dropped`, `volume.lease.granted`,
`volume.lease.denied`. Principals: `runtime` for lease events; the wakeup's raiser for wakeup
events. Identifiers: `turn` becomes real here — granted leases carry `lease`, and every event from
an agent instance carries the four-part identity (application instance, environment, activation,
turn). Retention: journal defaults; nothing new. Never recorded: what the turn did between wakeup
and block — rationale is never recorded.

## Approach

The lease is held by the platform, keyed by volume, granted to a turn at wakeup dispatch and
released at turn end or expiry. Queueing is per-environment, bounded by a topology declaration.
Mid-turn delivery (AC-M4.3) needs the harness to expose a blocking point the wakeup can land on —
this is the first real harness behaviour beyond request mediation. What could go wrong: lease
expiry racing turn completion (the spec's rule is writes-after-expiry fail, so expiry must be
enforced at the write path, not just at grant time); and the definition of "turn end" must be the
agent blocking or ending, observed by the harness, not a timeout guess.

## Decisions needed

- Lease duration and queue bound defaults, and where the topology declares them — review-level.
- If measured check-in latency behind a sweep is unacceptable (open question: "does the write lease
  make the campaign's shape unworkable?"), stop and take the evidence to the owner before M9 —
  the resolution the spec names is finer ledger volumes or a preemption rule it does not have.

## Verification

1. `pnpm check` — green.
2. Fixture: one writer environment whose turn writes, sleeps a configurable time, writes again.
3. Deliver two wakeups 100 ms apart; dump the journal; confirm sequential turns, `wakeup.queued`,
   and disjoint lease grant/release intervals (AC-M4.1).
4. Configure a short lease; hold a turn past it; attempt a write; confirm failure and
   `volume.lease.denied` (AC-M4.2).
5. Deliver a wakeup mid-turn to an interactive fixture; confirm resume without
   `instance.started`/environment restart in the journal (AC-M4.3).
6. Fill the queue to its declared bound; deliver one more; confirm `wakeup.dropped` with reason
   (AC-M4.4).
7. Run the timed fixture with a sweep-length turn (minutes); record delivered-to-started latency
   for the queued wakeup (AC-M4.5) in QA evidence.
