# Always (do without asking)

These actions are safe to take any time.

## Read

- Any file in this repo.
- Any logs or data in your local LocalStack.

## Run commands

- `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e`, `pnpm format`, `pnpm deps:check`.
- `pnpm local:up`, `pnpm local:down`, `pnpm bootstrap:local`, `pnpm doctor:local`.
- `pnpm --filter @agent-village/infra synth:dev` (and `synth:prod` for inspection — does not deploy).

## Modify code

- Add a new file inside one existing package.
- Add a new unit test (`*.test.ts`).
- Add a new entry to `LOG_EVENTS` in [`packages/shared/src/observability/events.ts`](../../packages/shared/src/observability/events.ts) and use it.
- Add a new Zod schema in `packages/shared/src/schemas/`.
- Add a new ADR file in `docs/adr/` (append-only; never edit an existing one).
- Add a new playbook in `docs/playbooks/` and link it from the index.

## Verification

After any of the above, run `pnpm lint && pnpm typecheck && pnpm test`. If green, proceed.
