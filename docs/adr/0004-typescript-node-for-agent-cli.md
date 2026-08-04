# ADR 0004: TypeScript on Node 22 for agent-cli

Date: 2026-08-02
Status: Proposed
Driver: [spec 0001](../specs/0001-agent-cli/spec.md)

## Context

[ADR-0001](0001-docs-first-spec-driven-reset.md) deliberately chose no language, runtime or cloud,
deferring those to "ADRs written from the first accepted spec".
[Spec 0001](../specs/0001-agent-cli/spec.md) is that spec, and it is specific about what it needs:

- a unix socket server whose accepting socket path is the only identity in the system
  ([ADR-0005](0005-socket-derived-principal-and-grant-layout.md));
- subprocess execution taking argv as an array with no shell anywhere on the execution path, a child
  environment constructed wholly from the recipe, and termination at process-group level;
- path resolution beneath a directory with every symlink refused at every component, plus a
  `dev`+`ino` re-check between the stat and the open;
- an HTTPS mechanism whose **emitted request-target bytes are under our control**, because rendering
  rules R1–R14 are normative about those bytes;
- append-only JSONL, and content hashing of argv, stdin, staged inputs, renderings and streams;
- one outbound POST for the approver, alongside the credential-refresh request — R13 makes both of
  them `http` renderings subject to every one of those rules without exception;
- a toolkit that scaffolds, validates, tests, diffs and deploys JSON artifacts, in exactly fifteen
  commands;
- a credential-free executable in every sandbox image, holding one constant.

The repository has exactly one toolchain today — Node 22 pinned in `.nvmrc`, pnpm, Prettier, and a
zero-dependency link checker, with `pnpm check` as the entire harness
([../dev/README.md](../dev/README.md)). [ADR-0002](0002-history-over-commentary.md) and
[ADR-0003](0003-auditability-is-a-requirement.md) both defer their mechanical enforcement to
whichever stack the first spec picks, and both say plainly that a review rule is the weaker form.

Two constraints from [../dev/design-principles.md](../dev/design-principles.md) bear directly:
simplicity ranks first among the tradeable goals, and every dependency is a liability justified in a
spec or an ADR rather than slipped in with a feature. DG7 fixes the budget in the spec itself —
**one runtime dependency, argued here**.

## Decision

**TypeScript on Node 22, pnpm, one package publishing two entrypoints**: the toolkit and auth
process, and a shim template that `deploy` materializes per wrap. The shim holds one constant, its
socket path, and never reads `basename(argv[0])`.

On-disk artifacts are JSON with `$schema`, and their schemas are generated from the same types that
validate at the wire boundary — so a policy schema change is a compile error in the checker rather
than a drift between a validator and a document nobody regenerates.

**One runtime dependency: a schema library, `zod`**, doing three jobs at once — validation at every
boundary, the source of the artifact schemas, and the typed shapes the audit lints below inspect.
Socket, framing, spawn, hashing, JSONL and HTTPS are standard library.

**A second dependency slot is reserved conditionally**, for a Linux directory-relative-resolution
binding. It is taken only if open question Q2 confirms the deployment target. Until then the portable
resolver ships, and G10 is stated at its weaker strength with the residual named in its Assumes
column: a race on a directory component swapped between two syscalls. AC-7.4 allows the lockfile to
resolve two runtime dependencies only in that case, and the shim entrypoint resolves zero either way.

### The outbound mechanism

**All three classes of outbound request — target, credential refresh, approver — go through
`node:https.request` with a request-target string this system builds itself. Not `fetch`.**

`node:https.request` takes `host`, `port`, `path` and `headers` as separate options, which is what R1
requires: no URL string is parsed at request time and no relative reference is ever resolved. It also
takes the explicit agent R12 specifies, with proxy support disabled, certificate validation fixed on,
and a resolver hook that can refuse a resolved address.

`fetch` cannot provide any of that, and the reason is not stylistic. Verified on node v22.19.0, the
version pinned by `.nvmrc`:

| Expression                                                     | Yields         |
| -------------------------------------------------------------- | -------------- |
| `new URL("http://h/api/%2e%2e/%2e%2e/admin").pathname`         | `/admin`       |
| assigning `u.pathname = "/api/%2E%2E/y"`, then reading it back | `/y`           |
| `new URL("//evil.example/x", "https://good.example").host`     | `evil.example` |
| `new URL("\\evil.example/x", "https://good.example").host`     | `evil.example` |

The WHATWG URL parser collapses percent-encoded dot segments and resolves protocol-relative
references, and `fetch` uses that parser. So a recipe whose `pathPrefix` and `verb.request.path`
together contain two escaping segments would reach a different segment sequence than the one the
policy evaluated — while `check` passed, every trial passed, and no file on disk was wrong. That
failure is invisible to every gate this spec otherwise has, which is exactly why it is a stack
decision and not an implementation detail.

Three further defects disqualify `fetch` even with the parser problem fixed:

- **Proxy environment variables.** Honouring them routes the credential through a proxy that may
  terminate TLS, which defeats the only thing binding an origin name to the party that answers for
  it. R12 forbids environment-derived configuration for this reason.
- **Transparent decompression.** It makes any byte cap count compressed bytes, so a small compressed
  response inflates past `limits.responseMaxBytes` inside the auth process. R6 fixes
  `accept-encoding` to `identity` and R11 measures the cap on relayed bytes after decoding; neither
  is expressible through a mechanism that decompresses on your behalf.
- **No hook to refuse a resolved address.** R12 requires refusing loopback, link-local (including
  `169.254.169.254`), private and CGNAT addresses with reason `origin-address-refused`. Without a
  resolver hook there is no place to put that refusal.

This is a correction this design makes to itself: the shorter spelling is the obvious one and it is
wrong. That is why R1 states the rule as the lint `no-url-parse-on-request-path` — forbidding
`fetch`, `new URL`, and assignment to `URL.prototype.pathname` anywhere in the request pipeline —
rather than as a sentence in this ADR that a later reader could reasonably ignore. AC-2.8 backs it by
asserting the bytes a local capture server observed, never the rendering's intent.

## Alternatives considered

| Alternative                       | Why not                                                                                                                                                                                                                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Go                                | A second toolchain in a repository whose entire harness is `pnpm check`, for a small shim and a single-process daemon. Its real advantage is a dependency-free static shim and native access to directory-relative resolution, and that pair is the one thing that would reverse this decision |
| Rust                              | The attack surface here is parsing and policy, not memory management, and the crate graph — serialization, an async runtime, an argument parser and their transitive trees — fights the dependency principle harder than Node's standard library does                                          |
| Python                            | No compile-time gate, so the audit-event union — the strongest ADR-0003 enforcement available — degrades to a lint over a convention                                                                                                                                                           |
| A vendor SDK for the approver     | A full SDK with its own release cadence and a shape the design would then accommodate, for one non-streaming POST that R13 already constrains completely                                                                                                                                       |
| TOML or YAML artifacts            | Multiple parsers with multiple readings of the same bytes. JSON diffs line by line, agents emit it reliably, and Prettier already formats it, so policy files are covered by `pnpm check` the day the first one lands                                                                          |
| A hand-written schema layer       | The zero-dependency ideal, but it re-implements the one dependency carrying three obligations at once, and a hand-written boundary validator is exactly where a boundary bug hides                                                                                                             |
| `fetch` as the outbound mechanism | Disqualified on the evidence in Decision above: percent-encoded dot-segment collapse, protocol-relative host resolution, proxy environment variables, transparent decompression, and no hook to refuse a resolved address                                                                      |

## Consequences

- **Easier:** no new toolchain, and artifacts are covered by the existing formatter immediately; the
  toolkit and the auth process share one type system, so a wrong change to an audit shape or a wire
  type fails at type-check rather than at review; the prose conventions below stop being review rules.
- **Harder:** every sandbox image now needs the runtime, which is a real cost `agent-environment`
  inherits, and the shim's cold start lands on every invocation inside an agent loop. Q12 measures
  both — the per-invocation latency and the image-size delta — rather than assuming either.
- **Accepted cost:** the portable path resolver is strictly weaker than the Linux syscall, and G10
  says so in its Assumes column rather than hiding it. The last inch of an `http` rendering is
  produced by an HTTP client this project does not own, which is why G7's Assumes column names that
  asymmetry and AC-2.8 asserts observed wire bytes.
- **Revisit if:** measured shim cold start exceeds the per-invocation latency the owner names in Q12;
  or Q2 confirms Linux and the native binding proves awkward enough that a small non-Node executor is
  cheaper than a binding, which is the Go case above; or a fourth runtime dependency becomes
  necessary, which would mean the boundary types are not carrying their weight.

## Prose conventions that become mechanical checks

This is the list [../dev/README.md](../dev/README.md) promises when a stack is chosen. AC-7.4 makes
the table a gate: one seeded fixture per rule, each turning the build red. The rules land with
[M1](../specs/0001-agent-cli/milestones/M1-gh-read-end-to-end.md), which is the first slice with code
to check.

| Convention                                                         | Check                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0002 — no commented-out code                                   | `no-commented-out-code`: re-parse every comment's text with the compiler and fail if it parses as statements or declarations. No phrase list, so no false positives on prose                                                                  |
| ADR-0002 — no change-narrating comments                            | `no-change-narrating-comments`: a phrase family — "was", "used to", "previously", "old approach", "keeping for reference", a bare date. **Explicitly the weaker of the two, and labelled so where it is configured**                          |
| ADR-0002 — no changelogs in live docs                              | A repository check that no `CHANGELOG` file exists, plus an extension to the link checker rejecting `History` and `Changelog` headings outside `docs/legacy/`                                                                                 |
| ADR-0003 — a closed event set                                      | `AuditEvent` is a union over a `const` tuple, so a free-form name is a compile error; plus a script asserting the spec's event table and the tuple are equal in both directions, failing when either side has a name the other lacks (AC-4.1) |
| ADR-0003 — a principal on every event                              | Each event's `Fields` type requires its envelope, so a record carrying neither principal nor actor is unconstructible                                                                                                                         |
| ADR-0003 — redaction is design, not a filter                       | `Redacted<T>` has no `toJSON` or `toString`; `no-secret-in-audit` forbids fields named token, password, secret, authorization or cookie in any audit payload type; `Fields` is a closed shape per event with no `any` and no index signature  |
| design-principles — contracts at boundaries                        | `boundary-must-parse`: nothing in the transport or artifact modules flows from a parsed document into application code without a schema                                                                                                       |
| Spec 0001 — no shell on the execution path                         | `no-shell`: no shell invocation, and subprocess imports confined to the execution module                                                                                                                                                      |
| Spec 0001 — nothing from the sandbox reaches the child environment | `no-env-on-request-path`: the process environment may not be read inside the request pipeline                                                                                                                                                 |
| Spec 0001 — the approver cannot widen                              | `verdict-constructed-only-in-decider`: a verdict value is constructible only inside the decision module, which is what G12 assumes                                                                                                            |
| Spec 0001 R1 — no URL parsing on the request path                  | `no-url-parse-on-request-path`: `fetch`, `new URL` and assignment to `URL.prototype.pathname` are forbidden in the request pipeline                                                                                                           |
| Spec 0001 R14 — no error passthrough                               | `no-error-passthrough`: a caught error's message, cause or serialized form is never interpolated into an agent-visible frame or an audit field                                                                                                |
| Spec 0001 R12 — certificate validation is not disableable          | A lint forbidding the identifier that would disable it, plus a startup refusal when the platform's certificate-validation kill switch is set in the auth process's environment                                                                |

## Audit surface

None of its own beyond the repository's, which is git history
([ADR-0002](0002-history-over-commentary.md)). This choice constrains what is recorded only insofar
as it makes the event contract compile-time rather than review-time: the closed event set becomes a
union over a `const` tuple, the per-event field shapes become types with no `any` and no index
signature, and redaction becomes a type with no serializer. That is the mechanical form
[ADR-0003](0003-auditability-is-a-requirement.md) asked a future stack ADR to provide, and it is why
no separate audit-mechanism ADR is needed.
