# M7: Egress decisions — invariants, auth environments, deferral, at-most-once

Spec: `../spec.md`
Status: Planned
Depends on: M5, M6

## Slice

Egress bridges make every kind of decision the spec defines. A flow invariant declared in the
topology is enforced at an egress bridge against ingress records: an egress whose contributing
flows include a third party the recipient is not is denied with reason
`taint-exceeds-recipient-trust`. A bridge routes a decision to an auth environment, records that
environment as the decider, and denies with a timeout reason when it does not answer — failing
open is never the default. A `defer` verdict suspends a crossing pending out-of-band approval,
survives an activation boundary, resolves against the original payload digest, and is refused if
the payload changed. A `retryable: false` request type writes a durable intent record before
invoking the upstream, and a death between `crossing.performing` and completion yields exactly one
terminal `crossing.indeterminate` and exactly one upstream call. The denial notice exists: a denied
crossing on a topology declaring an owner-notice path produces a platform-authored fixed-template
notice carrying no agent-authored content.

## Out of scope

- A real credentialed auth process — `agent-cli` territory, a spec non-goal. The auth environment
  here is a fixture that approves, denies, or hangs on command; what matters is the routing, the
  decider record, and the timeout.
- Owner-facing delivery of the indeterminate surface and the denial notice beyond a loopback
  egress — real transports are M9.
- Automatic retry with idempotency keys (`retryable: true` performing more than once) — exercised
  in M9 if a fixture needs it; the at-most-once side is the risky half and lands here.

## Acceptance criteria

| ID      | Criterion                                                                                                                                                                                                                | Serves | Verified by                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------------------------------------------------- |
| AC-M7.1 | A bridge routing its decision to an auth environment records the decider as that environment; a non-answering auth environment produces a deny with a timeout reason                                                     | AC-3.3 | Journal inspection with the auth environment stopped |
| AC-M7.2 | Killing the instance between `crossing.performing` and completion yields exactly one terminal `crossing.indeterminate` and exactly one upstream call                                                                     | AC-3.5 | Loopback upstream call count plus journal            |
| AC-M7.3 | An egress whose contributing flows include a third party the recipient is not is denied on the flow invariant with reason `taint-exceeds-recipient-trust`                                                                | AC-3.6 | Journal inspection                                   |
| AC-M7.4 | A deferred crossing survives an activation boundary, resolves against its original digest via `crossing.resolved` recording who supplied the verdict, and a resolution after the payload changed is refused and recorded | AC-3.7 | Journal inspection across two activations            |
| AC-M7.5 | A denied crossing on a topology declaring an owner-notice path emits the platform-authored fixed-template notice as its own crossing, carrying no agent-authored content                                                 | AC-3.2 | Journal plus notice content inspection               |
| AC-M7.6 | An egress event carries the set of contributing flows                                                                                                                                                                    | AC-4.1 | Journal inspection                                   |

## Audit surface

Events: `crossing.decided` with `defer`, `crossing.deferred`, `crossing.resolved`,
`crossing.performing`, `crossing.performed`, `crossing.failed`, `crossing.indeterminate`. Decider
recorded on every verdict — `program` or the routed environment. Identifiers: contributing-flows
set on egress events; the deferred crossing keeps its flow across activations. Retention: the
intent record is durable before the upstream call — that ordering is the guarantee. Never
recorded: rationale of an auth environment's model-made decision; credential values held by the
auth environment.

## Approach

Contributing-flows tracking needs the platform to know which admitted flows fed a turn — at this
stage, the flows whose wakeups and mounted session state fed it, carried on the turn and stamped on
its egress crossings. Flow invariants are named rules evaluated by the bridge against ingress
records reachable from those flows. Deferral needs durable pending-crossing state keyed by digest,
plus a platform-side resolution entry point. What could go wrong: AC-M7.2 is a crash-timing test —
the fixture upstream must count invocations durably and the kill must land between intent and
response (a fixture upstream that blocks until killed makes this deterministic); deferral survival
must be tested across a real activation end, not a simulated one.

## Decisions needed

- How contributing flows are attributed to a turn (everything the turn could have read vs. what its
  wakeup carried) — this bounds the honesty of AC-M7.6 and deserves explicit treatment in the PR;
  if the answer narrows the spec's meaning, it is a spec amendment, and per the spec it must not
  require observing reads.
- The out-of-band resolution channel's shape (a platform CLI against the pending store is enough) —
  review-level.

## Verification

1. `pnpm check` — green.
2. Auth-route fixture: crossing routed to the auth environment; approve once, deny once — confirm
   decider is the environment (AC-M7.1). Stop the auth environment; confirm deny with timeout
   reason (AC-M7.1).
3. Invariant fixture: two admitted flows (owner, third-party) feeding one turn; egress to a
   recipient who is not the third party → denied, reason `taint-exceeds-recipient-trust`;
   contributing flows on the event (AC-M7.3, AC-M7.6).
4. Notice: with the owner-notice path declared, confirm the denial produces the fixed-template
   crossing and diff its content against the template (AC-M7.5).
5. Kill test: `retryable: false` crossing against a counting loopback upstream that blocks; kill
   the instance mid-`performing`; restart; confirm one upstream invocation and terminal
   `crossing.indeterminate` (AC-M7.2).
6. Deferral: trigger a `defer`; end the activation; start a new one; resolve against the recorded
   digest — confirm `crossing.resolved` with supplier; mutate the payload of a second deferred
   crossing before resolution — confirm refusal, recorded (AC-M7.4).
