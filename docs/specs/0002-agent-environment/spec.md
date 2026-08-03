# Spec 0002: agent-environment

Status: Accepted
Accepted: 2026-08-03
Supersedes: —

## Summary

This spec defines **agent-environment**: mountable filesystems composed into sandboxed environments
that have no raw network, joined only by directional bridges that terminate a typed protocol, decide
on it, perform it, and record it — assembled into an agent application whose entry point is exactly
one ingress bridge. It is for the owner of this project, building three personal-agent applications
on one runtime: a mail assistant, a DM assistant, and a job-campaign agent. It is written now because
all three defend themselves by **topology** — quarantining untrusted input away from private data and
outbound reach — and that defence is worth nothing until the model says what a mount is, what a
bridge can see, and what the record of a decision contains.

## Design goals

| Goal                                                                              | Achieved when                                                                                                                                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| All three driving applications are expressible                                    | Each has a topology that the checker accepts, and its user flow runs end to end on the reference runtime without needing a concept this spec does not define                   |
| Untrusted input is separated from private data and outbound reach by construction | Quarantine is a property of the declared topology, refused before anything runs, rather than a convention application code is trusted to follow                                |
| Any consequence is traceable to its cause                                         | Given one flow identifier, an auditor recovers the admission, every crossing, every verdict and reason, and the mediated-volume versions each decision read — without guessing |
| The runtime is replaceable                                                        | The runtime interface is stated independently of its Docker implementation, and a second implementation could be written from the interface alone                              |
| The design is verifiable on a laptop                                              | Every acceptance criterion states whether it is locally checkable, and the entry-point bridge has a loopback transport in the architecture rather than in a test directory     |

## Terminology

**Binding on acceptance.** These words replace the sketch in [the project README](../../../README.md):
that sketch called a filesystem an "agent" and called a bridge "the only egress", and both broke
under all three driving applications. They are also deliberately not v0's meanings — v0's "agent" was
a configuration record and its "application" a container image plus a manifest.

| Term                     | Means                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Volume**               | A filesystem that can be mounted. Declares a durability class and, if durable, a version-retention bound. A volume with zero writers is immutable for the life of the application instance                                                                                                                                    |
| **Durability class**     | `ephemeral` (contents destroyed when the activation ends), `session` (destroyed at a declared flow boundary), or `durable` (outlives activations)                                                                                                                                                                             |
| **Mediated volume**      | A durable volume declared write-only-via-crossing. It is never read-write mounted; readers get a read-only mount pinned to a snapshot, and every change is a crossing to a bridge. Opt-in per volume                                                                                                                          |
| **Mount**                | The declared binding of a volume into an environment, naming role (`writer` or `reader`), mode, subtree, and — for a mediated volume — the pinned snapshot. A volume has at most one writer environment                                                                                                                       |
| **Write lease**          | A runtime-held, per-volume right to write, granted to at most one turn at a time. A wakeup that would start a turn needing a held lease is queued behind it, never run in parallel. Writes after lease expiry fail                                                                                                            |
| **Environment**          | A sandbox with a declared mount set, a declared set of request types it may invoke, at most one agent instance, and no raw network of any kind. It has no other way to reach data or capability                                                                                                                               |
| **Agent instance**       | A model plus a harness executing inside one environment. Identified as (application instance, environment, activation, turn), so that a logical role and one of its incarnations are distinguishable                                                                                                                          |
| **Harness**              | The component that assembles an agent instance's context and mediates its request-type invocations. It may invoke only the environment's declared request types, and must present admitted content together with its taint set                                                                                                |
| **Auth environment**     | An environment declared credential-holding, reached as a bridge's crossing target, which holds credentials and answers typed requests from another environment. It may contain an agent instance, so it can decide by asking a model. The pattern an `agent-cli` auth process is built into; not a distinct kind of component |
| **Turn**                 | One bounded unit of agent-instance work, from a wakeup to the point where the agent instance blocks or ends. The unit a write lease is granted to, and the finest correlation identifier                                                                                                                                      |
| **Wakeup**               | A delivered signal that starts or resumes a turn, raised by a bridge or by an external scheduler. Distinct from data: a file appearing is not a signal                                                                                                                                                                        |
| **Activation**           | One run of an application instance, from start to a terminal event. All of its environments run together and are co-located on one logical compute unit                                                                                                                                                                       |
| **Bridge**               | A directional policy checkpoint and actuator on a typed flow between an environment and exactly one target: the wider network, another environment, or a mediated volume. It terminates the protocol, decides, performs the action, and emits the record. It is not a socket, a connection, or a process                      |
| **Ingress bridge**       | A bridge that admits inbound messages. Declares a trigger mode (`dialed` or `listening`), verifies transport authenticity, resolves a taint set, mints a flow, and admits or rejects                                                                                                                                          |
| **Egress bridge**        | A bridge that emits. No bridge both admits and emits                                                                                                                                                                                                                                                                          |
| **Request type**         | A named member of a bridge's closed set of accepted calls. Declares `fidelity` (`parsed` — the bridge sees and validates every argument — or `opaque`), `content` (`structured` or `agent-authored`), `retryable`, and for a mediated-volume write, a policy class                                                            |
| **Decider**              | What produced a verdict: `program`, or the environment a bridge routed the decision to. Recorded on every verdict                                                                                                                                                                                                             |
| **Crossing**             | One request against a request type, plus its verdict, plus its effect. The audit unit and the correlation anchor                                                                                                                                                                                                              |
| **Taint set**            | The set of principals whose bytes are present in an admitted message — the owner, a mapped third party, or unknown. Resolved per originator rather than per envelope sender, so a forward or a quoted thread carries the third party's identity                                                                               |
| **Flow**                 | One admitted inbound message and everything causally downstream of it. Its identifier is minted at admission and required on every downstream event; an egress event carries the set of contributing flows                                                                                                                    |
| **Flow invariant**       | A named rule whose inputs are ingress records and whose enforcement point is an egress bridge — "a reply may address only participants of an owner-originated thread". Declared and reviewed as its own part of a topology                                                                                                    |
| **Subject**              | An application-declared `(kind, id)` correlation pair — thread, campaign, application-id — drawn from a vocabulary registered in the topology. Closed shape, open vocabulary                                                                                                                                                  |
| **Basis**                | The set of (mediated volume, snapshot) pairs an environment's read-only mounts were pinned to. Carried on every event that environment emits                                                                                                                                                                                  |
| **Topology**             | The declared volumes, environments, mounts, bridges, request types, flow invariants, and subject vocabulary of one application instance. Immutable for that instance's lifetime; resetting the contents of a session or ephemeral volume is not a change to it                                                                |
| **Agent application**    | The inert definition a topology is instantiated from, with exactly one ingress bridge named as its entry point                                                                                                                                                                                                                |
| **Application instance** | A named, owned, running deployment of an agent application: its topology, its volumes, and its activations. A principal                                                                                                                                                                                                       |
| **Journal**              | The audit event stream. Written only by the platform, and never mounted into any environment containing an agent instance                                                                                                                                                                                                     |
| **Content store**        | A separately permissioned, separately retained store holding the bodies that crossings decided on, joined to the journal by digest                                                                                                                                                                                            |

## User flows

### Mail assistant

**Trigger.** The owner emails the application's address. The ingress bridge holds the mail
credential, verifies DKIM/SPF/DMARC alignment, checks size and attachment policy and a per-window
rate, and resolves a taint set per originator — an owner-forwarded message from a recruiter is
`{owner, third-party:recruiter}`, not `{owner}`. On admission it mints a flow and writes the
normalised message to the mail spool.

**Steps.** A triage environment mounts the spool read-only and a request volume read-write. It holds
no private data and reaches no network. Its agent instance reads the raw message — which is fully
attacker-controlled text — and emits a schema-constrained request record. That record crosses a
bridge into the assistant environment, which mounts the assistant's memory read-only and pinned — it
is a mediated volume — and may invoke a small set of request types: research, calendar, memory write,
and mail send. It never sees raw mail bytes.

**What the owner sees.** A reply, in the same thread. If a crossing was denied, the owner gets a
platform-authored fixed-template notice on an egress path pinned to the owner's own address and
carrying no agent-authored content — because a denial that produces silence is indistinguishable from
a broken assistant.

**How it ends badly.** A stranger emails the assistant with instructions embedded in the body. The
ingress bridge admits it as inert content but never as an origination, so the stranger is not a
thread participant. The assistant may be steered into composing a reply to the attacker; the flow
invariant `reply-only-to-owner-originated-participants` is evaluated at the egress bridge against the
flow's ingress record, the crossing is denied with a stated reason, and the owner gets the notice.
The residual risk is real and stated: the same injection can steer _permitted_ actions — a calendar
deletion, a poisoned fact written to memory — and every crossing involved is individually correct.

### DM assistant

**Trigger.** The application instance is interactive, so it is long-running: its environments are up
and its ingress bridge holds the provider connection. A direct message arrives as a wakeup delivered
into the already-running assistant environment.

**Steps.** The assistant environment's agent instance takes a turn. Conversation state lives on a
session volume; anything the assistant should remember past the conversation is a crossing to a
mediated memory volume. A second message arriving mid-turn is a wakeup that queues behind the write
lease rather than starting a parallel turn.

**What the owner sees.** A reply in the DM, in seconds, plus streamed intermediate output where the
transport supports it — each streamed fragment is a crossing, decided and recorded like any other.

**How it ends badly.** In a shared channel, a coworker's message is admitted with taint
`{third-party:coworker}`, and an egress carrying owner-memory bytes to that channel is denied. If
agent-server has paused or torn down the instance to honour its machine bound, the provider's
acknowledgement deadline passes; the transport's own retry or backfill-from-cursor applies, and the
resulting duplicate or gap is agent-server's contract to state, not this spec's to hide.

### Job campaign agent

**Trigger.** Two kinds, into one application instance. A scheduled wakeup from an external scheduler
starts a sweep; an owner check-in arrives through the ingress bridge.

**Steps.** A search environment reaches job boards through a bridge with a hostname allowlist and
writes findings to a scratch volume — untrusted web text, no private data. A tailoring environment
reads the resume corpus and produces materials. One environment owns the campaign ledger as its
writer; both the nightly sweep and the interactive check-in are turns inside it, serialised by the
write lease. Submission goes through an egress bridge whose request type is `retryable: false`.

**What the owner sees.** A progress report, and an answer to "why did you apply to Stripe?" that
spans six weeks and many activations — answerable because every event carries the campaign subject,
and because the decision to submit carries the basis pinning the corpus snapshot it read.

**How it ends badly.** The instance dies between the submit bridge writing its intent record and the
upstream returning. The crossing is terminal `indeterminate`, surfaced to the owner, and never
automatically retried — because the upstream honours no idempotency key and a second attempt is a
second real application. A poisoned research note written in week 1 is legitimately read as
background in week 6; basis and the write crossing make the derivation reconstructable, and nothing
prevents the read.

## Architecture

### Composition

An agent application is a set of environments and bridges. Environments hold mounts, at most one
agent instance, and a declared set of request types. Bridges are the only thing that crosses between
an environment and anything else. There are exactly three crossing targets — the wider network,
another environment, and a mediated volume — and naming all three is deliberate: a shared mount and a
durable file write are real channels, and a model that calls a bridge "the only egress" while
permitting either is describing something it does not enforce.

Two environments may share a volume, but only one of them may be its writer. Co-mounted environments
can therefore pass data without a crossing. This spec does not forbid that; it makes it **visible**,
because the topology is declared, immutable, and published — so "which environments could have
reached the resume" is always answerable, even though "what they actually read" never is.

### The auth-environment route

A bridge decides either programmatically or by routing the decision to an environment. The second is
how a credential-mediated CLI works: the environment holding an agent invokes a wrapped command; the
bridge routes that invocation to an **auth environment**, which holds the credential and approves or
denies — programmatically, or by asking a model — and returns the result. The bridge on the network
side is then free to be thin: a hostname allowlist and a search request type.

The consequence worth stating plainly: **credentials live in an environment, not in a bridge.**
`agent-cli` is what an auth process is built with; this spec provides the composition — an
environment as a crossing target — that lets one run. Neither component is the other's subordinate.

### The runtime interface

The reference implementation is Docker. The interface it implements, stated so a second
implementation is possible, must provide:

- A per-environment network namespace with loopback only, which the application cannot modify.
- Mounts of exactly the declared volumes, at exactly the declared subtrees and modes, refusing any
  undeclared mount.
- Read-only mounts of mediated volumes pinned to a specific snapshot, and refusal of a read-write
  mount of one.
- A per-volume write lease, granted to one turn at a time, with writes after expiry failing.
- Delivery of a wakeup into a running environment.
- Destruction and recreation of `session` and `ephemeral` volume contents at their declared
  boundaries.
- Co-location of all of an activation's environments on one logical compute unit.

Left to the implementation: process supervision, image construction, how a volume is stored, and how
the local channel between an environment and a bridge is carried.

### Declaration and the checker

A topology is declared before anything runs and checked statically. The checker is what makes this
spec's terminology mechanical rather than descriptive: it rejects two writers on a volume, a
read-write mount of a mediated volume, a mount without a subtree, the journal mounted into an
agent-bearing environment, a credential-class volume mounted into an environment not declared
credential-holding, and a credential-holding environment mounting a volume another environment
writes.
It also **surfaces** rather than rejects the topology's weak spots — a mediated-volume write bridge
whose policy class is `allow-all` is reported as an unmediated write path, so it cannot pass
silently.

Request types are declared in one place per environment, **including platform-injected ones**. A
platform-supplied default may never widen an application's declared surface: the failure to prevent
is a platform convenience entry that quietly turns an allowlist into an exfiltration channel.

### Local verification

The entry-point bridge has a loopback transport in the architecture. Every guarantee below is
probe-able on one machine with no account anywhere, and that is a design requirement rather than a
testing convenience — a guarantee that can only be checked on deployed infrastructure is an
unverified claim.

## Guarantees

| Guarantee                                                                                                                                                                 | Holds because                                                                                                                                                                                          | Assumes                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| An environment cannot originate a network connection of any kind — TCP, UDP, DNS, or IPv6                                                                                 | It is given a network namespace with loopback only; every outbound effect is a typed crossing over a local channel                                                                                     | The runtime creates a namespace the application cannot modify and the local channel is not itself routable. Unlike a redirect-based chokepoint this has no per-protocol exclusions to plug, which is the reason for the design and also the whole of the claim                                                                 |
| A volume not in an environment's declared mount set is unreachable from it                                                                                                | The runtime mounts only declared volumes, only at declared subtrees, and the topology is immutable for the instance lifetime                                                                           | The runtime enforces mount namespaces and refuses undeclared mounts; no sandbox escape. Co-location makes this an intra-host boundary, not a machine boundary                                                                                                                                                                  |
| A mediated volume is never read-write mounted, and every change to one is a crossing carrying a digest, a principal, a flow, and a verdict                                | The checker rejects a read-write mount of a mediated volume, and the only other write path is a bridge request type                                                                                    | The runtime can refuse a read-write mount and can pin a read-only mount to a snapshot. A runtime that bind-mounts read-write and reconciles in the background does not satisfy this                                                                                                                                            |
| No volume has two concurrent writers                                                                                                                                      | A volume has at most one writer environment, and within it the runtime grants a write lease to at most one turn; a wakeup needing a held lease is queued                                               | The runtime holds the lease and writes after expiry fail. This bounds interleaving, not sequencing — ordering between an application's own turns remains the application's problem                                                                                                                                             |
| The journal has exactly one writer, the platform, and is not readable from any environment containing an agent instance                                                   | It is a topology property checked at declaration, before anything runs                                                                                                                                 | The checker runs at declaration and the runtime refuses to start a rejected topology                                                                                                                                                                                                                                           |
| An agent instance cannot alter its own prompts, skills, or policy within an application instance's lifetime                                                               | Those live on a zero-writer volume mounted read-only, and the topology is immutable; changing them requires declaring a new topology, which is itself an event                                         | The runtime honours zero-writer as read-only at the mount rather than by convention                                                                                                                                                                                                                                            |
| A credential-class volume is mounted only into an environment declared credential-holding, and no such environment mounts a volume another environment writes             | The checker rejects a credential-class mount anywhere else, and rejects a credential-holding environment mounting a volume whose writer is a different environment                                     | Whoever declares the topology labels credential-class volumes correctly — a declaration-review property, not a content scan. A credential-holding environment may contain an agent instance, because deciding by asking a model is the point; what it is exposed to is bounded by its bridge's request types, not by this rule |
| An irreversible upstream effect is attempted at most once per crossing                                                                                                    | The bridge writes a durable intent record before invoking the upstream; a crossing with an intent and no completion is terminal `indeterminate`, surfaced to the owner and never automatically retried | The intent record is durable before the upstream call. This is at-most-once, not exactly-once: exactly-once across a boundary we do not control is not achievable, and an audit record is not a completion oracle                                                                                                              |
| Every event carries application instance, activation, flow, principal, and subject list; every event from an environment mounting mediated volumes also carries its basis | The platform stamps the envelope; the application supplies only its own subject vocabulary values                                                                                                      | The application declares its subject vocabulary in the topology and closes subjects it opens                                                                                                                                                                                                                                   |

### Stated non-guarantees

These are limits, not claims, and they are written here rather than discovered later.

- **Reads are never observed.** What a reader actually read from a volume, and when, is not recorded
  — including within a single writer environment. The model bounds reach; it does not observe use.
  An application needing per-read decisions must route that data through a bridge.
- **A mediated write records; it prevents only as far as its policy class is decidable.** A memory
  bridge that must accept arbitrary agent-authored text has no decision to make and will allow every
  time. Its value is attributable recording with the body preserved. `allow-all` is accepted and
  reported as an unmediated write path so it cannot pass silently.
- **Bridges bound the destinations, shapes, and quantities of consequences. They do not bound
  intent.** A prompt-injected agent choosing a permitted action is indistinguishable at every
  crossing from an agent doing its job. Whether a topology split is real also depends on harness
  context assembly, which this spec does not specify. Claiming safety from the combination of
  untrusted input and outbound capability would be over-claiming.
- **The model provider is inside the trust boundary.** Every agent-bearing environment has a
  mandatory `model.infer` request type; it is fully parsed and always allowed, its content is
  agent-authored, and sending the private data _is_ the operation. If a provider offers server-side
  search or fetch, that mandatory entry becomes general unmonitored egress.
- **Taint does not survive a write into a volume.** Once attacker-influenced bytes are summarised
  into a mediated volume, the derivation is reconstructable — basis pins what was read, the write
  crossing pins what created the version — but nothing prevents a legitimate downstream read.
- **`durable` is a class name in this spec.** What survives an application-instance restart, and
  where it is stored, is agent-server's contract. This spec expresses the class and the retention
  key; it does not promise persistence.
- **Rationale is never recorded.** Why an agent chose an action happens inside an environment where
  by construction there is no trust boundary and so no event.

## Audit surface

Required by [ADR-0003](../../adr/0003-auditability-is-a-requirement.md).

**What is recorded.** A closed set of stably named events. Denials and no-ops are events.

| Group     | Events                                                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lifecycle | `topology.declared`, `topology.rejected`, `instance.started`, `instance.stopped`, `activation.started`, `activation.ended`, `activation.deadline_exceeded`                   |
| Volumes   | `volume.mounted`, `volume.digest`, `volume.reset`, `volume.lease.granted`, `volume.lease.denied`                                                                             |
| Wakeups   | `wakeup.delivered`, `wakeup.queued`, `wakeup.dropped`                                                                                                                        |
| Ingress   | `ingress.connection.accepted`, `ingress.connection.refused`, `ingress.principal.resolved`, `ingress.message.admitted`, `ingress.message.rejected`, `ingress.poll.completed`  |
| Crossings | `crossing.requested`, `crossing.decided`, `crossing.deferred`, `crossing.resolved`, `crossing.performing`, `crossing.performed`, `crossing.failed`, `crossing.indeterminate` |
| Content   | `content.stored`, `content.read`, `flow.summary`                                                                                                                             |

`crossing.decided` is the single decision event, carrying `{verdict: allow | deny | defer, decider,
reason, request_digest}` — there is no second name for a verdict, and a quota refusal is
`crossing.decided` with `verdict: deny` and a reason-enum member rather than its own event. Each
event has a closed reason enum, disjoint between ingress and egress. `ingress.poll.completed` fires
on an empty poll, and `topology.rejected` fires when a declaration is refused.

A `defer` verdict suspends the crossing pending an out-of-band approval — the owner approving a job
application before it is submitted. The deferred crossing keeps its flow and survives an activation
boundary; `crossing.resolved` records the eventual verdict and who supplied it, and a resolution is
refused if the payload digest has changed since the deferral. A bridge with no deferral path denies
instead; deferring forever is a denial that never reaches the owner.

One deliberate absence: a write blocked by a read-only mount fails in the kernel inside the sandbox
and is not observable to the platform on the expected first runtime. That denial is therefore moved
earlier — to `topology.rejected` at declaration time, where it is mechanically checkable. The spec
does not claim per-write-failure observability it cannot deliver.

**On whose behalf.** Every event names a principal from a closed set: `owner`, `application-instance`,
`agent-instance` (as application instance + environment + activation + turn, so a logical role and
one of its incarnations are distinguishable), `bridge`, `runtime`, `third-party:<mapped id>`,
`unknown`, and `unauthenticated-peer`. The last is the honest answer for pre-authentication ingress,
where no principal has been resolved yet, and is stated rather than left blank. An admitted message
additionally carries its taint set.

**With what identifiers.** `application_instance`, `activation`, `turn`, `flow`, `subject[]`,
`basis[]`, plus volume and version on write crossings and `lease` on lease events. An egress event
carries the set of contributing flows, which is what makes a consequence traceable to an admission
weeks earlier. `flow` is the key an auditor starts from; `subject` is the key that survives across
flows and activations.

**Where it goes and who may read it.** Two stores with two permission sets. The journal holds
envelopes, verdicts, reasons, deciders, and digests; it is written only by the platform, never
mounted into an agent-bearing environment, and readable only by the owner of that application
instance. The content store holds the bodies crossings decided on, joined by digest, requires a
separate grant, and emits `content.read` on every read. Neither is readable across users, and neither
is reachable from any environment. Storage and cross-user enforcement are agent-server's to
implement; this spec states the requirement and owns the retention key.

**How long it is kept.** Every class has an age and a size bound with defined behaviour at the bound.

| Class                                                 | Bound                                                                                                                                                                                                             | At the bound                                                                                                                                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Journal, post-authentication                          | Declared per subject kind; floor 30 days, ceiling 400 days; default 1 GiB per application instance                                                                                                                | Rows dropped at the age bound. At the size bound the oldest flow's rows collapse to one `flow.summary` — counts by event name and verdict, first and last timestamp — so growth stops without the flow vanishing |
| Mediated-volume write crossings                       | Retained at least as long as the version they created is reachable. Each mediated volume declares a finite version-retention bound, ceiling 400 days, and that bound is the journal bound for its write crossings | State and provenance expire together                                                                                                                                                                             |
| Ingress, pre-authentication                           | Never per-row. Counters per (bridge, minute) plus sampled exemplars, default 1 in 1000 and at most 1000 per hour per bridge, age bound 7 days                                                                     | Counters aggregate to daily totals; exemplars dropped                                                                                                                                                            |
| Content-store bodies not attached to a mediated write | Default 30 days, declared per request type, ceiling 90 days; default 5 GiB per instance                                                                                                                           | Body deleted, journal keeps the digest — the crossing stays provable once the text is gone                                                                                                                       |

Retaining a write crossing as long as the version it created is the clause that makes the rest
useful: without it a fact planted in week 1 outlives the record of its planting, and the exploitation
in week 8 is unexplainable.

**What is deliberately not recorded.** Credentials and any value labelled credential-class. The
plaintext of `model.infer` bodies — digest, byte count, and token counts only, because recording them
verbatim would make the audit log the largest unredacted copy of the owner's private data in the
system. Rationale. Per-file reads and per-file writes on mounted volumes. The contents of ephemeral
volumes. Any request type declaring `content: agent-authored` has its body recorded by digest and
metadata in the journal, and by value only in the content store under that store's bound.

## Edge cases

| Case                                                                                                          | Behaviour                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two wakeups arrive for the same writer environment at once                                                    | Both are recorded; the second's turn queues on the write lease (`wakeup.queued`). Neither is dropped, and they never run in parallel                                                            |
| A wakeup arrives for an environment already at its queue bound                                                | `wakeup.dropped` with a reason. The bound is declared in the topology; silent coalescing is not permitted                                                                                       |
| A deferred crossing is resolved after the payload it referred to has changed                                  | The resolution is refused and recorded. What the owner approved is a digest, not an intention                                                                                                   |
| The instance dies between `crossing.performing` and the upstream response                                     | The crossing is terminal `crossing.indeterminate`, surfaced to the owner. Retried automatically only if the request type declares `retryable: true`, which requires an upstream idempotency key |
| An admitted message exceeds the declared size bound                                                           | Rejected at ingress with a stated reason before any body is stored                                                                                                                              |
| Inbound message fails transport authenticity                                                                  | `ingress.message.rejected`; the body is not written to any volume, and the sender is not resolved to a principal                                                                                |
| A stranger's message arrives at an application whose flow invariant permits only owner-originated threads     | Admitted as inert content with taint `{unknown}` or `{third-party:x}`; it cannot originate a flow that authorises a reply to its sender                                                         |
| An egress carries bytes whose contributing flows include a third party the recipient is not                   | Denied at the egress bridge on the flow invariant, with reason `taint-exceeds-recipient-trust`                                                                                                  |
| A declared topology has two writers on a volume, or read-write mounts a mediated volume                       | `topology.rejected` before anything runs. The instance does not start                                                                                                                           |
| A bridge's decision is routed to an auth environment that does not answer within its deadline                 | `crossing.decided` with `verdict: deny` and a timeout reason. Failing open is never the default                                                                                                 |
| An agent instance invokes a request type its environment did not declare                                      | Refused by the harness and recorded. The environment's request-type set is closed                                                                                                               |
| A session volume's flow ends while a turn still holds its write lease                                         | The reset waits for lease release or expiry; `volume.reset` carries the pre-reset digest                                                                                                        |
| The journal reaches its size bound mid-flow                                                                   | Oldest flows collapse to `flow.summary` first. The active flow is collapsed last                                                                                                                |
| An application declares a mediated-write bridge with policy class `allow-all`                                 | Accepted, and reported by the checker and in `topology.declared` as an unmediated write path                                                                                                    |
| A durable volume's version-retention bound elapses while its write crossing is still within the journal bound | The version and its write crossing expire together; the shorter of the two governs neither alone                                                                                                |

## Non-goals

- **Credential storage and the auth-process protocol.** Belongs to `agent-cli`. This spec supplies
  the composition an auth process runs in, and says credentials live in an environment.
- **Users, deployment, scheduling, and cloud persistence.** Belongs to `agent-server`, including
  honouring the residency this spec expresses, bounding concurrently running instances against a
  fixed machine count, and enforcing the retention bounds declared here.
- **Dynamic topologies.** Environments are not created or destroyed during an application's life.
  Not ever, on current evidence: static declaration is what makes the checker possible.
- **Harness context-assembly policy.** Whether admitted text reaches a model as data or as
  instructions is a harness property. This spec requires the taint set to be presented and stops
  there — not yet, and worth its own spec.
- **Observing reads.** Not ever under this design; an application needing per-read decisions routes
  the data through a bridge instead.
- **A spend or token ledger.** Cost is bounded by machine count in `agent-server`, not by per-call
  accounting here. Not yet.
- **Multi-tenant isolation between application instances.** Co-location is within one instance. Two
  instances sharing a host is `agent-server`'s boundary to state.
- **Bounding the number of actions an application takes.** "Applied to 400 jobs overnight" is not a
  per-crossing decision and no mechanism here prevents it. Not yet, and called out because it is a
  likely real failure.

## Scoping guidance

Mid-build, decide with these tests rather than with principles:

- **Does it change what may cross a boundary, or what is recorded about a crossing?** In scope.
- **Does it require the runtime to do something new?** In scope, and it goes in the runtime interface
  section — where it is visible as a cost against the claim that Docker is one implementation rather
  than the definition.
- **Does it name a user, a machine budget, a schedule, or a cloud service?** Out of scope; it is
  `agent-server`'s.
- **Does it hold a credential?** Out of scope as a mechanism; in scope only as the environment that
  holds it and the bridge that routes to it.
- **Would it be settled by reading application code rather than a topology?** Out of scope. This spec
  describes what is declared and checked, not what an application chooses to do inside an
  environment.
- **Is a new bridge warranted, or would co-mounting do?** A bridge is warranted when a decision must
  be made or a record must exist at that boundary. If neither, co-mount and let the topology show it
  — a pass-through bridge is overhead charged on every change, and the discipline that matters is
  that co-mounting stays visible rather than that it never happens.

## Acceptance criteria

Locally checkable unless marked otherwise.

| ID     | Criterion                                                                                                                                                                                          | Verified by                                              |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| AC-1.1 | A topology declaring two writer environments for one volume is rejected, with a reason naming the volume                                                                                           | Checker run over a fixture topology                      |
| AC-1.2 | A topology read-write mounting a mediated volume is rejected                                                                                                                                       | Checker run over a fixture topology                      |
| AC-1.3 | A topology mounting the journal into an agent-bearing environment is rejected                                                                                                                      | Checker run over a fixture topology                      |
| AC-1.4 | A topology mounting a credential-class volume into an environment not declared credential-holding is rejected, as is a credential-holding environment mounting a volume another environment writes | Checker run over a fixture topology                      |
| AC-1.5 | A mount without a declared subtree is rejected                                                                                                                                                     | Checker run over a fixture topology                      |
| AC-1.6 | A mediated-write bridge with policy class `allow-all` is accepted and reported as an unmediated write path, in both checker output and `topology.declared`                                         | Checker output plus journal inspection                   |
| AC-2.1 | A probe agent in an environment fails to open TCP, UDP, DNS, and IPv6 connections to any address                                                                                                   | Protocol sweep from inside a running environment         |
| AC-2.2 | A volume not in an environment's mount set is absent from its filesystem, and an undeclared mount request fails to start the instance                                                              | Filesystem inspection plus a rejected start              |
| AC-2.3 | Two wakeups 100 ms apart into one writer environment produce two turns in sequence, with `wakeup.queued` for the second and no overlapping lease                                                   | Journal inspection                                       |
| AC-2.4 | A `session` volume is empty at the start of the next flow, and `volume.reset` carries the pre-reset digest                                                                                         | Journal plus filesystem inspection                       |
| AC-2.5 | A read-only mount of a mediated volume is pinned: its contents do not change while a newer version exists                                                                                          | Filesystem inspection during a concurrent write crossing |
| AC-3.1 | Every write to a mediated volume appears as a crossing carrying a digest, principal, flow, and verdict; no other write path exists                                                                 | Journal inspection plus a direct-write attempt           |
| AC-3.2 | A denied crossing emits `crossing.decided` with `verdict: deny`, a reason from the closed enum, and a decider                                                                                      | Journal inspection                                       |
| AC-3.3 | A bridge routing its decision to an auth environment records the decider as that environment, and a non-answering auth environment produces a deny with a timeout reason                           | Journal inspection with the auth environment stopped     |
| AC-3.4 | An agent instance invoking an undeclared request type is refused and the refusal is recorded                                                                                                       | Journal inspection                                       |
| AC-3.5 | Killing the instance between `crossing.performing` and completion yields exactly one terminal `crossing.indeterminate` and exactly one upstream call                                               | Loopback upstream call count plus journal                |
| AC-3.6 | An egress whose contributing flows include a third party the recipient is not is denied on the flow invariant                                                                                      | Journal inspection against the mail fixture              |
| AC-3.7 | A deferred crossing survives an activation boundary, resolves against its original digest, and is refused if the payload changed                                                                   | Journal inspection against the campaign fixture          |
| AC-4.1 | Given one flow identifier, the admission, every crossing, every verdict and reason, and each decision's basis are recoverable without guessing                                                     | Reconstruction walkthrough, executed and recorded        |
| AC-4.2 | A fact written in flow 1 and exploited in flow 2 after the general journal bound has elapsed is still explainable: the planting crossing and its body survive because the version does             | Clock-advanced run over the mail fixture                 |
| AC-4.3 | Pre-authentication ingress events are stored as counters plus sampled exemplars; 10,000 refused connections do not add 10,000 rows                                                                 | Journal size inspection under a connection flood         |
| AC-4.4 | No event name outside the declared closed set appears in the journal                                                                                                                               | Lint over emitted events                                 |
| AC-4.5 | No credential, `model.infer` body plaintext, or per-file read appears anywhere in the journal or content store                                                                                     | Grep over a full fixture run                             |
| AC-5.1 | All environments of an activation are co-located on one logical compute unit, and the activation has exactly one terminal event                                                                    | Runtime inspection plus journal                          |
| AC-5.2 | An interactive instance receives a wakeup mid-turn and resumes without restarting the environment                                                                                                  | Journal inspection against the DM fixture                |
| AC-6.1 | Mail assistant, DM assistant, and job campaign agent each exist as a topology the checker accepts, and each user flow in this spec runs end to end against loopback transports                     | Three fixture applications, run and recorded             |
| AC-6.2 | No step of AC-6.1 requires a cloud account, a registered domain, or a deployed service                                                                                                             | The AC-6.1 run, executed on a disconnected machine       |

## Open questions

| Question                                                                                                                                                                                                | Blocks                                                                                                                                                                                            | Resolved by                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Must taint survive a write into a volume, or is basis-plus-write-crossing reconstruction enough?                                                                                                        | Any quarantine claim stronger than topological. A week-1 research note derived from a scraped page is read as trusted background in week 6                                                        | Building the campaign corpus in a milestone and attempting the reconstruction on a real multi-week trace. If it is only possible by already suspecting the answer, taint becomes a mount property and the terminology reopens |
| What is the smallest useful set of policy classes for mediated-write bridges?                                                                                                                           | Whether AC-1.6 is a meaningful control or a label everyone applies. If every durable write is `allow-all` in practice, the mediated-volume guarantee is recording only                            | Building the mail assistant's memory bridge and recording what it can actually decide — schema, size, rate, path prefix — versus what it must wave through                                                                    |
| Is the runtime interface too narrow to be called general? Pinned snapshots, write leases, and wakeup delivery are requirements on the interface, not on Docker                                          | The claim that Docker is one implementation rather than the definition, which is a stated project goal                                                                                            | Sketching a second runtime against the interface before acceptance. If nothing but Docker can satisfy it, say so here instead of implying generality                                                                          |
| For binary artifacts — the campaign submits a PDF — does a bridge parse it, inheriting a parser's attack surface and still missing visually invisible text, or pass it `opaque`?                        | The campaign's submit path, and honest labelling of the one artifact carrying all the owner's PII across every boundary                                                                           | A milestone attempting both against a real resume and a hostile one, recording what each caught                                                                                                                               |
| Does the write lease make the campaign's shape unworkable? One writer environment for the ledger serves both a nightly sweep and an interactive check-in, so a check-in queues behind a long sweep turn | Whether "small resident tracker plus burst searcher" is expressible, or the ledger owner must be coarse                                                                                           | Measuring queue latency in AC-2.3 with a realistic sweep length. If a check-in waits minutes, the ledger splits into finer volumes or the lease needs a preemption rule this spec does not have                               |
| Will agent-server keep a listening ingress bridge addressable while its instance is paused, and can it give each _instance_ — several per user — a routable address and TLS identity?                   | Whether webhook-shaped transports are buildable at all, and therefore part of AC-6.1                                                                                                              | The agent-server spec, or an owner decision to make webhook transports a platform non-goal                                                                                                                                    |
| Should the `model.infer` request type carry a spend meter here, or is metering agent-server's?                                                                                                          | A denial-of-control channel: if an auth environment's decisions share a metering path with the assistant's agent, an injected assistant can exhaust the budget the decider needs to keep deciding | An owner ruling on the spec boundary                                                                                                                                                                                          |
| Does ADR-0003's retention rule need an explicit amendment recording that it governs audit records rather than application state?                                                                        | Whether the first reviewer applying the ADR literally blocks the mail assistant's memory feature or exempts it without saying so                                                                  | An owner ruling, recorded as an ADR amendment. This spec assumes the audit-records reading                                                                                                                                    |

## Changes since acceptance

| Date | Change | Why |
| ---- | ------ | --- |
| —    | —      | —   |
