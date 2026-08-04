# M6: Ingress, flows, and taint

Spec: `../spec.md`
Status: Planned
Depends on: M4

## Slice

An ingress bridge with a loopback transport admits inbound messages: it verifies transport
authenticity, checks size and rate policy, resolves a taint set per originator, mints a flow, and
raises a wakeup — replacing M1's placeholder flow with the real thing. A rejected message leaves no
body on any volume and resolves no principal. Pre-authentication events are never stored per row:
refused connections aggregate to per-(bridge, minute) counters with sampled exemplars, so a
connection flood cannot bloat the journal. Admitted content carries its taint set to the harness,
which presents it with the content — the boundary the spec requires even though context-assembly
policy is a non-goal.

## Out of scope

- Egress-side use of taint (flow invariants, `taint-exceeds-recipient-trust`) — M7. M6 records
  taint; M7 decides on it.
- Real mail/DM transports — M9 builds fixtures; DKIM/SPF verification specifics belong to the mail
  fixture's ingress bridge there. M6's loopback transport carries authenticity assertions the
  fixture can vary.
- The entry-point rule (exactly one ingress bridge per application) — checked since M2; M6 makes
  it operative.

## Acceptance criteria

| ID      | Criterion                                                                                                                                                               | Serves | Verified by                                      |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------ |
| AC-M6.1 | An admitted message emits `ingress.principal.resolved` and `ingress.message.admitted`, mints a flow, and every downstream event of the resulting turn carries that flow | AC-4.1 | Journal inspection                               |
| AC-M6.2 | A message failing transport authenticity emits `ingress.message.rejected`; its body is on no volume and no principal is resolved                                        | AC-4.5 | Journal plus filesystem inspection               |
| AC-M6.3 | 10,000 refused connections produce counters plus sampled exemplars, not 10,000 rows                                                                                     | AC-4.3 | Journal size inspection under a connection flood |
| AC-M6.4 | Taint is resolved per originator: an owner-forwarded third-party message is admitted with taint `{owner, third-party:<id>}`                                             | AC-3.6 | Journal inspection                               |
| AC-M6.5 | An admitted message exceeding the declared size bound is rejected with a stated reason before any body is stored                                                        | AC-4.5 | Journal inspection                               |
| AC-M6.6 | An empty poll on a `dialed` ingress bridge emits `ingress.poll.completed`                                                                                               | AC-4.4 | Journal inspection                               |

## Audit surface

Events: `ingress.connection.accepted`, `ingress.connection.refused`, `ingress.principal.resolved`,
`ingress.message.admitted`, `ingress.message.rejected`, `ingress.poll.completed`, with reason enums
disjoint from egress. Principals: `unauthenticated-peer` pre-resolution — stated, not blank — then
the resolved principal; admitted messages additionally carry taint sets. Identifiers: `flow` minted
at admission. Retention: pre-authentication rows never stored per event — counters per (bridge,
minute), exemplars sampled at the spec's defaults (1 in 1000, ≤ 1000/hour/bridge, 7-day age
bound). Never recorded: bodies of rejected messages.

## Approach

The loopback transport is the architecture's own (spec: "in the architecture rather than in a test
directory"): a local listener the platform owns, fed by fixture drivers. Taint resolution needs an
originator-mapping declared in the topology (who maps to `owner`, to `third-party:<id>`), applied
per originator so forwards and quoted threads carry the third party. The counter path must be a
separate write path from the journal's event path — same store, different granularity. What could
go wrong: rate/size checks must run before body persistence, or AC-M6.2/M6.5 fail by architecture;
sampling must be deterministic enough to test (seedable).

## Decisions needed

- How the topology declares originator→principal mapping and per-bridge policy (size, rate, queue) —
  schema-level, review in PR.
- Trigger modes: M6 must implement `listening`; implement `dialed` at least for the poll event
  (AC-M6.6) so both modes exist before M9 needs them.

## Verification

1. `pnpm check` — green.
2. Fixture: one ingress bridge (loopback), one triage-shaped environment woken by admission.
3. Send an authentic owner message; dump journal; trace flow id from admission through the turn's
   crossings (AC-M6.1).
4. Send a message failing authenticity; confirm rejection event, no principal, and grep every
   volume for its body (AC-M6.2).
5. Send an owner-forwarded third-party message; confirm the two-member taint set (AC-M6.4).
6. Send an oversized message; confirm rejection reason and no stored body (AC-M6.5).
7. Flood with 10,000 refused connections; measure journal row count and confirm counters plus
   exemplars within sampling bounds (AC-M6.3).
8. Run an empty `dialed` poll; confirm `ingress.poll.completed` (AC-M6.6).
