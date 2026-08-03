# Phase 0 — Harness (done)

What's already in the repo so the next agent doesn't re-build it.

## Delivered

- **Monorepo** with `pnpm` workspaces + Turborepo. Node 22 pinned.
- **9 packages** with [layered dependency graph](../architecture/layered-packages.md) enforced by `dependency-cruiser`.
- **Strict ESLint** with [hard bounds as errors](../conventions/file-size-bounds.md) + two custom rules ([structured logging](../conventions/structured-logging.md), [Zod at boundaries](../conventions/schemas-at-boundaries.md)).
- **Test harness:** Vitest workspace, `aws-sdk-client-mock` helpers in `packages/data/test-utils/`, Playwright smoke test, `tests/structural/` suite.
- **Local dev:** LocalStack + DynamoDB Local via [`docker-compose.yml`](../../docker-compose.yml). Scripts: `bootstrap:local`, `doctor:local`.
- **AWS CDK** ([`packages/infra/`](../../packages/infra/)) — 6 stacks stubbed: Data, Auth, Api, Runner, Web, Monitoring. Per-env typed config. `cdk-nag` integrated.
- **CI/CD** in [`.github/workflows/`](../../.github/workflows/) — PR verification + auto-deploy to dev on merge + tag-and-approval prod deploy via OIDC.
- **Git hooks** in `.husky/`: lint-staged + deps:check on pre-commit, full verify on pre-push, conventional-commit format on commit-msg.
- **Documentation** under [`docs/`](../README.md) following iterative-disclosure pattern.

## What's NOT here

- No product code. No User / Agent / Run schemas yet. No Lambdas wired in CDK. No frontend routes.
- All `packages/*/src/index.ts` files are stubs that export `{}`.
- `api-stack.ts` and `runner-stack.ts` are placeholders that accept their props but create no resources.

Phase 1 fills these in. See [phase-1-mvp.md](phase-1-mvp.md).
