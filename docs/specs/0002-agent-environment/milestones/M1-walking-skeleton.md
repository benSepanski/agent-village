# M1: Walking skeleton — declare, check, run, cross, record

Spec: `../spec.md`
Status: Planned
Depends on: —

## Slice

An operator declares a minimal topology — one environment holding a probe agent, one egress bridge
with one program-decided request type — and the checker accepts it. The Docker runtime starts the
environment with a loopback-only network namespace. The probe invokes the declared request type and
the crossing is allowed, performed, and journaled; it invokes an undeclared request type and the
refusal is journaled; it sweeps TCP, UDP, DNS, and IPv6 and every attempt fails. The journal is a
platform-written store no environment can reach. This was not true before because nothing existed:
this milestone is the thinnest path through declaration, checking, runtime, bridge, harness, and
journal, and it exists to prove the spec's riskiest assumption — network denial by namespace, not by
filtering — before anything is built on top of it.

## Out of scope

- Volumes beyond an implicit ephemeral root — durability classes, mounts, subtrees are M3.
- Wakeups, turns as a lease unit, and queueing — M4. The probe runs as a single turn.
- Full checker rejection rules — M2. M1's checker accepts the fixture and refuses only what it
  cannot represent.
- Ingress, flows, and taint — M6. M1 events carry a placeholder flow minted at activation start.
- Content store and retention — M8. M1 journals envelopes and digests only.

## Acceptance criteria

| ID      | Criterion                                                                                                                                                                      | Serves | Verified by                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------- |
| AC-M1.1 | A probe agent inside the running environment fails to open TCP, UDP, DNS, and IPv6 connections to any address                                                                  | AC-2.1 | Protocol sweep from inside a running environment  |
| AC-M1.2 | Invoking the declared request type emits `crossing.requested`, `crossing.decided` (allow, `decider: program`), `crossing.performed`, in order, sharing one crossing identifier | AC-4.1 | Journal inspection                                |
| AC-M1.3 | A program-denied crossing emits `crossing.decided` with `verdict: deny`, a reason from the closed enum, and a decider                                                          | AC-3.2 | Journal inspection                                |
| AC-M1.4 | Invoking a request type the environment did not declare is refused by the harness and the refusal is recorded                                                                  | AC-3.4 | Journal inspection                                |
| AC-M1.5 | The journal is absent from the environment's filesystem, and no path writable from the environment feeds it                                                                    | AC-1.3 | Filesystem inspection from inside the environment |
| AC-M1.6 | Every event emitted in this milestone uses a name from the spec's closed event set and carries application instance, activation, flow, and principal                           | AC-4.4 | Grep over the journal from a full fixture run     |

## Audit surface

Events: `topology.declared`, `instance.started`, `activation.started`, `activation.ended`,
`crossing.requested`, `crossing.decided`, `crossing.performed`. Denials and refusals are events
(AC-M1.3, AC-M1.4). Principals: `runtime`, `bridge`, `agent-instance` with the four-part identity
from the spec's terminology. Identifiers: `application_instance`, `activation`, `flow`, `turn`.
Destination: a journal file owned by the platform process, outside every container. Retention: none
enforced yet — M8 owns bounds; M1 must not exceed the spec's "what is deliberately not recorded"
list. Never recorded: request bodies (digest only), anything from inside the environment except via
a crossing.

## Approach

Pick the implementation language and record it as an ADR before writing code — it also decides
which of the repo's review-rule conventions become lint rules
([dev README](../../../dev/README.md)). Then: a topology file format (likely JSON or similar,
checked by a `topology.declared`-emitting loader), a runtime shim over the Docker API that creates
the container with `network_mode` giving loopback only, a bridge process on the host side of a
Unix-socket channel mounted into the environment, and a probe agent that is a script, not a model —
`model.infer` is not needed to prove the skeleton. What could go wrong: the local channel must not
itself be routable (a mounted Unix socket is fine; a host-network TCP listener is not), and Docker's
embedded DNS may leak resolution even with networking disabled — the sweep in AC-M1.1 must cover
it.

## Decisions needed

- **Implementation language and runtime stack** — ADR required; constrains every later milestone.
- **How the local channel between environment and bridge is carried** — the runtime interface
  leaves it to the implementation; record the choice and why it is not routable in the ADR or the
  milestone doc.

## Verification

Written before the work; QA reproduces it:

1. `pnpm check` — green.
2. Run the documented fixture command to declare and start the skeleton topology.
3. From the probe's entrypoint, run the network sweep (TCP connect to a public IP, UDP send, DNS
   resolve via the container's resolver, IPv6 connect); capture output showing every attempt fails
   (AC-M1.1).
4. Invoke the declared request type; invoke an undeclared one; invoke one the program policy
   denies.
5. Dump the journal. Confirm the event sequences of AC-M1.2 – AC-M1.4, the closed-set names and
   envelope fields of AC-M1.6, and no journal path visible inside the container (AC-M1.5 — `ls`
   the mount table from within).
6. Capture the journal excerpt and sweep output as QA evidence.
