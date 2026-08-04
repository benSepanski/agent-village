# M1: One gh read verb, end to end, with authoring cost measured

Spec: `../spec.md`
Status: Planned
Depends on: —

## Slice

An agent inside a sandbox runs `gh issue list --repo <owner>/<repo> --limit 20` and gets GitHub's own
output, having never held the token. A generated shim on the sandbox's `PATH` carries one constant —
its socket path — and forwards the invocation over a per-wrap unix socket in its grant directory. The
auth process derives the principal from the socket path it accepted on, normalizes argv against the
recipe's verb grammar under total match, denies by default, allows by one named rule, appends
`verdict.allowed` **before** anything is spawned, runs `gh` with the credential and an environment
constructed wholly from the recipe, and streams stdout and stderr back on separate frames. An
unmodeled subcommand denies at exit 77 with the canonical block.

Alongside it, the `http` recipe schema and its `check` shape rules exist and `agent-cli simulate`
prints an `http` rendering — but **nothing http executes, connects, or holds a credential**. The
author hand-writes four Slack verbs from an empty `new recipe --kind http` skeleton for one reason
only: to measure what hand-authoring an `http` verb costs, while it is still free to find out.

The milestone is not done until the QA document publishes AC-5.5's T1–T4 for **both** kinds.

## Out of scope

| Not here                                         | Where instead |
| ------------------------------------------------ | ------------- |
| `workspace-path` arguments, staging, config root | M2            |
| The `http` emitter, and any outbound request     | M2            |
| A second policy, and the full `check` gate set   | M3            |
| Any real `http` target, credential or origin     | M4            |
| `doctor`, `observe`, drift, retention            | M5            |
| The model approver and any `ask` rule            | M6            |

## Acceptance criteria

| ID       | Criterion                                                                                                                                         | Serves         | Verified by                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| AC-M1.1  | An allowed `gh issue list` returns GitHub's stdout, stderr and exit code unchanged, with the streams never merged                                 | AC-1.1         | Byte comparison against running `gh` directly, asserting on separate file descriptors                                         |
| AC-M1.2  | A denial exits 77, prints the canonical block with its exact field set, and spawns no child                                                       | AC-1.1, AC-1.4 | A denial suite with process accounting showing zero child spawns                                                              |
| AC-M1.3  | Exactly one verdict record exists per accepted connection, and `count(execution.started) ≤ count(verdict.allowed)` under randomized interruption  | AC-1.2, AC-4.1 | Chaos harness over 10,000 connections, including SIGKILL mid-decision                                                         |
| AC-M1.4  | The principal on every record is derived from the accepting socket path, and the envelope schema has no field in which identity could be asserted | AC-2.2, AC-4.2 | Schema test; connecting to an ungranted path fails; a shim invoked with a hostile `argv[0]` still reaches only its own socket |
| AC-M1.5  | No allow ever carries a residual argv token, and a `string` value with a leading `@` is refused                                                   | AC-2.5         | argv fuzzer over the shipped `github` recipe                                                                                  |
| AC-M1.6  | Editing a deployed policy file changes no verdict; only `deploy` does                                                                             | AC-2.6         | Edit-in-place while the auth process runs, then re-invoke                                                                     |
| AC-M1.7  | The event names emitted equal the spec's Audit surface table in both directions, and an unlisted name fails the build                             | AC-4.1         | Two-way set check in `pnpm check` parsing the spec's table; a fixture emitting an unlisted name                               |
| AC-M1.8  | One session reconstructs end to end from the journal alone                                                                                        | AC-4.2         | A synthetic fixture of known shape replayed by `sessionId`                                                                    |
| AC-M1.9  | `check` fails on an unclassified effect, an empty `why`, and a missing trials file                                                                | AC-5.2         | One seeded fixture per gate, each naming file, field and fixing command                                                       |
| AC-M1.10 | The lockfile resolves one runtime dependency and the shim entrypoint resolves zero                                                                | AC-7.4         | Lockfile and resolution checks in `pnpm check`                                                                                |
| AC-M1.11 | T1–T4 are measured and published for both kinds, with the intervention log                                                                        | AC-5.4, AC-5.5 | The QA document for this milestone                                                                                            |

## Audit surface

This slice introduces the trust boundary, so it introduces most of the record.

**Emits:** `authd.started`, `authd.stopped`, `invocation.received`, `invocation.rejected`,
`request.unmapped`, `verdict.allowed`, `verdict.denied`, `credential.bound`, `execution.started`,
`execution.completed`, `execution.timeout`, `execution.cancelled`, `output.truncated`,
`recipe.changed`, `policy.changed`, `wrap.deployed`, `explain.answered`.

**Principal:** `{app, instance, session, wrap}`, every field derived from
`grants/<app>/<instance>/<session>/<command>.sock` per
[ADR-0005](../../../adr/0005-socket-derived-principal-and-grant-layout.md). Authoring events carry
`actor` and `gitCommit` instead.

**Correlation:** `requestId` per accepted connection, `execId` per spawn, `sessionId`/`instanceId`/
`app` from the grant path, `policyDigest`/`recipeDigest`/`surfaceDigest` for the text that decided,
and `seq` monotonic per journal.

**Destination and retention:** append-only JSONL in whole UTC day-files under the auth process's own
directory. The 30-day / 2 GiB bounds are declared here and **enforced in M5**; this milestone must not
ship a journal that cannot express them.

**Never recorded:** credential material in any form including its length, the child's environment
values, stdin/stdout/stderr bytes, and values of `redact` fields. Redaction runs during normalization,
before the request exists in a loggable form.

## Approach

Build the thinnest path that touches every layer, in this order: the wire framing and the shim; socket
path to principal; the recipe and policy schemas with `zod` at the boundary; argv normalization under
total match; the rule evaluator with its `deny` default; the journal append; then the spawn. Depth
before breadth — an ugly working path teaches more than three polished components that have never met.

What could go wrong, in rough order of how much it would cost:

- **`gh --help` does not yield argument types.** The whole DG2 bet rests on `help-walk` producing a
  usable skeleton. If the author ends up hand-writing every `args` block, T1 blows out and the spec is
  in trouble. This is why the milestone is first.
- **Verdict-before-spawn is easy to get subtly wrong** under interruption. The append must be flushed,
  not queued, before the spawn call, and AC-M1.3 is the check.
- **The shim's cold start** is paid on every invocation (Q12). Measure it here; it is cheap now and
  expensive to discover in M4.

## Decisions needed

- [ADR-0006](../../../adr/0006-typescript-node-for-agent-cli.md) and
  [ADR-0005](../../../adr/0005-socket-derived-principal-and-grant-layout.md) are both `Proposed`. They
  move to `Accepted` on the strength of this milestone, or they are revised by it.
- **Open question Q2** — where the auth process runs — decides whether the portable path resolver or
  the Linux syscall ships, and therefore G10's stated strength. M1 does not stage files, so it can
  proceed under either answer, but M2 cannot.
- **This is the milestone where the spec can be found nonviable.** If T1 or T3 fails, the correct
  output is a written case and a question to the owner — Abandon or rescope — not a workaround. Per
  [specs/README.md](../../README.md), an agent does not decide that.

## Verification

Written before the work starts, so "it works" cannot be defined after the fact.

```bash
pnpm check
agent-cli check && agent-cli test && agent-cli deploy
```

1. **Allowed path.** From inside the sandbox, run `gh issue list --repo <owner>/<repo> --limit 20`.
   Capture stdout and stderr to separate files. Run the same command outside with the same credential.
   Assert the files are byte-identical and the exit codes match. Evidence: both captures and the diff.
2. **Denied path.** Run `gh pr merge 412 --squash`. Assert exit 77, the canonical block's exact field
   set, and — via process accounting captured across the run — zero `gh` spawns. Evidence: the block
   verbatim and the accounting output.
3. **Explain.** Re-run the denied command with `AGENT_CLI_MODE=explain`. Assert an identical verdict,
   zero `credential.bound`, zero `execution.started`, and exactly one `explain.answered`.
4. **Verdict ordering.** Run the chaos harness for 10,000 connections with randomized SIGKILL. Assert
   no duplicate `requestId`, and `count(execution.started) ≤ count(verdict.allowed)`. Evidence: the
   counts and any violating record.
5. **Identity.** Attempt to connect to a socket path outside the grant directory; assert failure.
   Invoke the shim through a symlink named something else; assert it still reaches only its own socket.
6. **Deployed set.** Edit the deployed policy file in place, re-invoke, assert the verdict is
   unchanged. Then `deploy` and assert it changes.
7. **Cost.** Commit the `new recipe --introspect help-walk` skeleton as its own commit **before**
   editing it. At the first green `agent-cli test`, run `git diff --numstat` between the two commits on
   the recipe file, divide added+changed lines by verbs shipped, and record the median and total.
   Repeat from the empty `new recipe --kind http` skeleton for the four hand-written Slack verbs.
   Record summed session durations and every owner intervention with its category. Evidence: the
   numstat output, the durations, and the intervention log, all in the QA document, compared against
   AC-5.5's T1–T4.
