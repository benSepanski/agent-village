# ADR 0003: Auditability is a requirement

Date: 2026-08-02
Status: Accepted
Driver: repo-wide

## Context

agent-village exists to give agents real capabilities: credentials they can use without holding,
filesystems they can mount and mutate, network egress mediated by a bridge, machines that cost money
while they run. Every one of those is a place where the honest answer to "what happened?" must come
from a record, because no human watched it happen and the agent's own account of its actions is not
evidence.

Auditability added late is auditability that is wrong: the interesting events are the ones a
component decided not to take, or took on someone else's behalf, and those are invisible unless the
component was built to record them. Retrofitting also tends to log what is convenient rather than
what is load-bearing.

There is a cost dimension too. Logs from long-running interactive sessions are unbounded by nature,
so "keep everything" is not a policy — it is an unpriced liability.

## Decision

**Every component states its audit surface as part of its design, before it is built.** A spec or
milestone that cannot describe its audit surface is incomplete, and the ADR template asks for it too.

A component's audit surface answers:

1. **What is recorded** — the events, as a closed set with stable names, not free-form strings.
   Every decision at a trust boundary is an event, including denials and no-ops.
2. **On whose behalf** — the principal (user, agent instance, application instance) is attributable
   on every event. "The system did it" is not an answer.
3. **With what identifiers** — enough correlation (instance, session, run) to reconstruct one
   session end to end without guessing.
4. **Where it goes and who can read it** — including the rule that one user's records are never
   readable by another.
5. **How long it is kept** — an explicit size and age bound, with defined behaviour at the bound
   (dropped, truncated, summarized). Unbounded retention is not a valid answer.
6. **What is deliberately not recorded** — secrets, credentials, and payload bodies that would leak
   them. Redaction is part of the design, not a filter added later.

Approval decisions get particular emphasis: every `agent-cli` auth-process verdict and every bridge
egress decision is an audit event carrying the request, the verdict, the reason, and the decider
(program or model). An approval nobody can review later is indistinguishable from no control at all.

## Alternatives considered

| Alternative                                                        | Why not                                                                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Treat observability as a cross-cutting concern added per milestone | It is exactly the concern that cannot be added afterwards — the events that matter are decisions the code has already thrown away by then. |
| Log freely with unstructured strings                               | Unqueryable, unstable under refactor, and impossible to check mechanically. v0 found closed event enums worth the friction.                |
| Keep all logs indefinitely                                         | Unbounded cost on a system whose whole point is bounded cost; and a growing pile of others' data to protect.                               |

## Consequences

- Easier: any session can be reconstructed; a denial can be explained to the person it happened to;
  cost and retention are visible rather than emergent.
- Harder: every design conversation carries an extra section, and boundaries have to name their
  principals precisely — which is uncomfortable exactly where the design is vague.
- Accepted cost: emitting and storing structured records is real overhead in both runtime and
  authoring effort.
- This is a requirement on specs, enforced by review today. Once a stack exists, the event shape
  should become a mechanical check (a schema plus a lint rule), and that becomes its own ADR.
- Revisit if: a component's audit surface turns out to be a strict subset of a shared platform
  facility, at which point the requirement moves to that facility rather than being dropped.

## Audit surface

This ADR's own surface is the repository's: specs and ADRs record which components claimed which
audit surfaces, and QA docs record whether those claims were actually met.
