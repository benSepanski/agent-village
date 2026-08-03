# ADR 0001: Docs-first, spec-driven reset

Date: 2026-08-02
Status: Accepted
Driver: repo-wide

## Context

v0 of agent-village shipped a working personal agent scheduler on AWS — a nine-package TypeScript
monorepo with CDK infrastructure, a DynamoDB single-table data model, Cognito auth, Fargate sandbox
runs behind an egress proxy, and a metered Anthropic gateway. It was dogfooded and it worked.

The problem we now want to solve is different and more general: sandboxed capability wrappers
(`agent-cli`), mountable agent filesystems composed into environments with bridges as the only
egress (`agent-environment`), and an operator surface that bounds cost by construction
(`agent-server`). See [../../README.md](../../README.md).

Keeping v0 as a starting point would mean inheriting an architecture chosen for the old problem —
its data model, its layering, its AWS coupling — and then arguing each piece back out. Incremental
migration also hides which parts of the new design are actually agreed, because working code reads
as agreement whether or not anyone decided it.

Separately, v0's own conclusion was that agent contributions are safe to merge in proportion to how
much of the standard is mechanically enforced rather than described. That conclusion is worth
keeping even though the code is not.

## Decision

Reset the repository to documentation only, and gate all implementation on an accepted design spec.

- The v0 docs are archived verbatim under `docs/legacy/v0/`, frozen and non-authoritative. The v0
  code is deleted; git history is its record.
- No language, runtime, cloud, or framework is chosen by this reset. Those become ADRs written from
  the first accepted spec, not inherited defaults. The only tooling that survives is a Prettier
  check and a relative-link check over the docs.
- Work proceeds in two loops, documented in [../../CONTRIBUTING.md](../../CONTRIBUTING.md):
  - **Outer** — iterate with the owner to a design spec, accept it, build it, complete or abandon
    it, then ask the owner for the next spec.
  - **Inner** — decompose an accepted spec into milestones; execute, QA the milestone, QA against
    the spec.
- Specs live in [../specs/](../specs/) and are the design target. On acceptance, a spec's
  terminology and guarantees are binding on the code.
- Agents do not choose the next spec and do not implement uncovered work. When there is no spec,
  the correct output is a proposal and a question, not code.

## Alternatives considered

| Alternative                                              | Why not                                                                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Refactor v0 incrementally toward the new design          | Imports an architecture chosen for a different problem, and lets working code stand in for decisions nobody made.            |
| Keep the TypeScript/pnpm/CDK harness, drop only app code | Pre-decides language, package manager, and cloud before the spec exists — the three choices most likely to shape the design. |
| Delete the v0 docs along with the code                   | Cheap to keep, and the reasoning is occasionally worth mining. Freezing them costs one skip rule in the harness.             |
| Start a new repository                                   | Loses the history that makes the deletion recoverable and the evolution legible.                                             |

## Consequences

- Easier: the design can be argued on its merits; every component's contract is stated before it is
  built; the first ADRs on stack choices are made with the requirements in hand.
- Harder: nothing runs, and nothing will for a while. Progress is measured in spec quality, which is
  harder to feel than a green test suite.
- Accepted cost: v0's working features (auth, scheduling, spend control, sandbox runs) will have to
  be re-earned rather than carried over. Their designs remain readable in `docs/legacy/v0/`.
- Revisit if: two or more consecutive specs are abandoned as nonviable during implementation, which
  would suggest specs are being written at the wrong altitude and the loop itself needs rework.

## Audit surface

Repository-level only: the reset is three commits (archive, delete, scaffold), so the transition and
everything deleted stay recoverable from git history. See
[0002-history-over-commentary.md](0002-history-over-commentary.md).
