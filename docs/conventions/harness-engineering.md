# Harness engineering — the operating rules

The "harness" is the set of mechanical constraints that keep an agent (you) productive and the codebase legible: linters, type-checks, layered package boundaries, Zod schemas, dependency-cruiser, hooks, CI, ADRs, and pointer-style docs. The harness is what makes agent contributions safe to merge without line-by-line human review.

This doc explains the principles behind the harness and how they show up in this repo. **You don't need to read it to do most tasks** — the harness enforces itself. Read it when you're designing a new piece of the harness, debating whether to relax a rule, or curious why the repo is shaped this way.

## Why the harness exists

Free-form text instructions to an agent degrade. They get out of date, they get partially followed, and they don't fail loudly when ignored. Mechanical enforcement — a lint rule, a CI check, a type error — fails loudly _every_ time. So the rule is: encode standards in mechanisms, not prose.

A useful heuristic: if a rule matters, it should be enforced by something that turns the build red when violated. If it can't be, downgrade it to "guidance" and stop treating it as a rule.

## Principles

### 1. Mechanism over memory

Quality is enforced by tools, not by remembering what was written in AGENTS.md. The repo already encodes:

- File / function / complexity / param-count limits as **ESLint errors** ([file-size-bounds](file-size-bounds.md)).
- Structured logging shape as a **custom ESLint rule** ([structured-logging](structured-logging.md)).
- Zod parsing at trust boundaries as a **custom ESLint rule** ([schemas-at-boundaries](schemas-at-boundaries.md)).
- Package import direction as a **dependency-cruiser** check ([layered-packages](../architecture/layered-packages.md), [module-boundaries](module-boundaries.md)).
- Conventional commits as a **commit-msg hook**.
- Per-env infra invariants as **cdk-nag** rules.

When you find yourself reaching for "remember to do X", look for a way to turn it into a check instead. A new ADR can capture the intent; a lint rule, a structural test, or a CI step makes it true.

### 2. Don't loosen rules to pass

The most common failure mode is editing the lint config (or the test, or the schema) to make the build green. Don't. The rule encodes a judgment that was made deliberately; fix the code instead. If you genuinely believe the rule is wrong, raise it as an ADR and get the change approved — don't silently disable it in a PR that has another purpose.

### 3. Tests and schemas are ground truth; prose rots

Descriptive documentation ("the user object has fields X, Y, Z") goes stale silently. A Zod schema or a test goes stale loudly — it fails. So:

- Prefer a Zod schema over a paragraph describing a shape.
- Prefer a test over a comment explaining "this must be true".
- Prefer an ADR (dated, statused) over a free-form design note.

The corollary: don't add prose docs that re-describe what the code already says. Link to the code instead.

### 4. Iterative disclosure — pointer-style docs

[AGENTS.md](../../AGENTS.md) is a **map**, not a manual. [docs/README.md](../README.md) is a **router**, not an index of everything. Each doc under `docs/` answers one question on one screen. This keeps any single context window cheap and prevents the "1000-line AGENTS.md" trap where instructions burn the budget before the task starts.

Rules of thumb when writing docs:

- One doc, one question. If a doc has two answers, split it.
- Link aggressively to other docs and to code. Broken links fail loudly in CI; vague prose doesn't.
- If a fact can be derived from `git log`, code, or a test — don't write it down. Link to the source.

### 5. Validate at boundaries, allow autonomy inside

Every Lambda handler must `.parse(...)` its input through a Zod schema ([schemas-at-boundaries](schemas-at-boundaries.md)). Every package can only import from the packages below it ([layered-packages](../architecture/layered-packages.md)). Inside those boundaries, write whatever idiomatic code is clearest. The point of the harness isn't to micromanage style — it's to make the _interfaces_ trustworthy so the interiors can move fast.

### 6. Fast feedback beats slow feedback

The ordering matters: editor (ms) → pre-commit hook (s) → pre-push hook (s) → CI (min) → human review (hours). Push checks as far left as you can. If you find yourself waiting on CI to learn that lint failed, run `pnpm lint` locally first. If a check belongs in a pre-commit hook but isn't, that's a harness gap worth fixing.

For this repo specifically:

- `pnpm install` is the bootstrap step in any fresh worktree — it installs the **devDependencies** (lint-staged, husky, eslint, prettier, dependency-cruiser) that the pre-commit and pre-push hooks call. Without it, your first commit fails with `Command "lint-staged" not found` and the hook gives no hint why. pnpm includes devDeps by default, so plain `pnpm install` is correct — don't pass `--prod`.
- Node ≥22 is required (pinned in [`.nvmrc`](../../.nvmrc)). The hooks themselves try to source `nvm use 22`, but the shell you invoke `git commit` from must already resolve `node` to v22+ or pnpm's corepack shim crashes on modern JS syntax before the hook ever runs.
- `pnpm lint` / `pnpm typecheck` / `pnpm test` are the local equivalents of CI.
- `pnpm doctor:local` is the "is my environment broken?" check — run it before chasing weird failures.
- `pnpm local:up` brings up LocalStack + DynamoDB Local; don't try to debug data-layer changes without it.

### 7. Plan before executing non-trivial work

For anything beyond a small focused change, write the plan first — what files will change, what tests will be added, what could break. The phase docs ([phases/](../phases/)) are the planning artifact at the project level; ADRs ([adr/](../adr/)) are the planning artifact for cross-cutting decisions. At the task level, a few sentences in the PR description is enough. The point is to surface the approach before you've spent the budget executing it.

### 8. Verify before declaring done

"It compiles" is not "it works". Before declaring a task done:

- Run `pnpm test` for unit/integration coverage.
- Run `pnpm e2e` for any UI-touching change.
- For Lambda or infra changes, run `pnpm --filter @agent-village/infra synth:dev` to confirm CDK still synthesizes.
- For data-shape changes, exercise the changed path end-to-end through the local stack.

If you can't verify a change behaves correctly (e.g., something only reproduces in deployed infra), say so explicitly in the PR — don't claim verification you didn't do.

### 9. Single source of truth lives in the repo

If a fact about the system matters, it should be in the repo: in code, in a test, in a schema, in an ADR, or in `docs/`. Facts that live only in Slack, a Google Doc, or someone's head are inaccessible to future agent runs and will be silently violated. When you learn something load-bearing, write it down here.

### 10. Fight entropy on purpose

Repos drift. Dead code accumulates, docs go stale, lint configs grow exceptions. Treat entropy as a first-class concern:

- When you touch a file, leave it at least as clean as you found it.
- If you spot dead code with high confidence, delete it; if you spot stale docs, fix or remove them.
- Flag larger cleanup needs separately rather than smuggling them into unrelated PRs.

## How to extend the harness

When you propose a new harness piece (a lint rule, a structural test, a hook, a CI step):

1. **Write an ADR** under [docs/adr/](../adr/) describing what the rule enforces and why.
2. **Make it fail loudly** — error, not warning; required check, not advisory.
3. **Link the error message back to the ADR** so the next agent who trips it understands the why.
4. **Update [docs/README.md](../README.md)** if the new rule introduces a question worth routing to a doc.

## How to read this repo's harness

If you want a tour of what's already in place, [phase-0-harness.md](../phases/phase-0-harness.md) lists every harness piece delivered in Phase 0 with links. That's the most useful single-page view of "what the harness is" in this codebase.
