# Module boundaries

You can only import from a package along the **allowed-edges graph**. Anything else fails CI.

See [architecture/layered-packages](../architecture/layered-packages.md) for the table.

## Public entry points

Import from `@agent-village/<pkg>`, not `@agent-village/<pkg>/src/...`. Each package's `package.json` `exports` field defines what's external.

To expose a new helper:

1. Add it to the package's `src/`.
2. Re-export it from that package's `src/index.ts` (or from a named subpath in the `exports` map).
3. Run `pnpm typecheck` from the consumer to confirm.

## Adding a new package

Adding a top-level package is an "Ask First" action — see [permissions](../permissions/ask-first.md). It requires updating:

1. [`.dependency-cruiser.cjs`](../../.dependency-cruiser.cjs) to declare its allowed imports.
2. [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) (already includes `packages/*`).
3. [`packages/<name>/package.json`](../../packages/) and `tsconfig.json`.
4. [`docs/architecture/layered-packages.md`](../architecture/layered-packages.md) to document its role.

## Verifying

```bash
pnpm deps:check                  # explicit run
pnpm test                        # included in the structural test suite
```
