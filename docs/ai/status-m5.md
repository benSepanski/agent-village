# Milestone M5 status — Extensibility & Connectivity

Milestone M5 delivers acceptance criteria **AC-5.1–5.4** (extensibility) and
**AC-6.1–6.5** (connectivity) from the
[1.0 definition](./1.0-definition.md).

---

## Acceptance criteria delivered

### Extensibility (AC-5.1–5.4)

- **AC-5.1** — A dependent repo can inject a validated `EnvConfig` without
  editing platform source. The loader accepts unknown `env` names when
  `AV_ENV_CONFIG_PATH` points to a JSON file.

- **AC-5.2** — Synth-snapshot tests prove the first-party (`dev`/`prod`)
  templates are unchanged by the injection refactor, byte-for-byte apart from
  one documented, intentional diff: cdk-nag IAM5 `appliesTo` suppression
  lists are now parameterized by env/prefix instead of a73a924's hardcoded
  both-envs lists, so a single-env synth no longer carries the other env's
  (always-inert) ARN entries in its suppression metadata. See
  `stripKnownCrossEnvAppliesTo` in `synth-baseline.ts` for the full
  justification. Every other field — every deployed resource property and
  IAM statement — is compared byte-for-byte against a baseline genuinely
  captured from the pre-refactor tree (commit a73a924). Both capture and
  comparison pin `WebStack` to placeholder mode (`AV_WEB_FORCE_PLACEHOLDER=1`
  — see `web-stack.ts`) so the snapshot is deterministic regardless of
  whether `packages/web/dist` happens to be built locally or in CI; an
  earlier version of this baseline was accidentally captured with `dist`
  present, which passed only when a developer had already built the web app
  and failed in CI (which doesn't build web before unit tests) — fixed by
  pinning the mode on both sides.

- **AC-5.3** — [app-development.md](../app-development.md) documents both
  paths clearly: (a) consume an existing deployment as an app repo, (b)
  deploy your own platform instance via config injection.

- **AC-5.4** — A real dependent-project fixture (e.g. apply-bot) synthesizes
  and exercises its own instance via the injection contract.

### Connectivity (AC-6.1–6.5)

- **AC-6.1** — **Anthropic-only** recipe: allow-path reaches the metering
  gateway; deny-path shows off-list hosts are blocked at egress.

- **AC-6.2** — **Read-only Notion** recipe: allow-path reads via allowlisted
  Notion host with a scoped token; deny-path proves off-list host / token-less
  access is blocked.

- **AC-6.3** — **Partial email** recipe: allow-path sends/reads via
  implicit-TLS ports (993/465) to allowlisted mail hosts; deny-path proves
  STARTTLS ports (143/587) are blocked.

- **AC-6.4** — Each recipe is documented in `docs/recipes/` with example
  structure, manifest, grants, and allow/deny test locations.

- **AC-6.5** — **Negative (scope)**: no MCP transport, no SSE streaming, no
  STARTTLS path introduced.

---

## Test coverage

| Criterion                 | Test type                  | Location                                                                                              |
| ------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| AC-5.1 — Config injection | Unit + Integration         | `packages/infra/config/schema.test.ts`, `packages/infra/test/config.test.ts`                          |
| AC-5.2 — Synth zero-drift | Unit (snapshot)            | `packages/infra/test/synth-snapshot.test.ts`                                                          |
| AC-5.3 — Documentation    | Manual (doc review)        | [app-development.md](../app-development.md)                                                           |
| AC-5.4 — Fixture          | Integration                | `packages/infra/test/apply-bot-fixture.test.ts`                                                       |
| AC-6.1 — Anthropic-only   | Integration (allow + deny) | `packages/services/src/sandbox-egress.test.ts`, `packages/infra/test/proxy-allowlist.test.ts`         |
| AC-6.2 — Notion recipe    | Integration (allow + deny) | `packages/services/src/sandbox-egress.test.ts`, `packages/infra/test/proxy-allowlist.test.ts`         |
| AC-6.3 — Email recipe     | Integration (allow + deny) | `packages/services/src/sandbox-egress.test.ts`, `packages/infra/test/proxy-allowlist.test.ts`         |
| AC-6.4 — Recipe docs      | Manual (doc review)        | `docs/recipes/anthropic-only.md`, `docs/recipes/notion-read-only.md`, `docs/recipes/email-partial.md` |
| AC-6.5 — Negative scope   | Unit (grep/contract)       | `packages/infra/test/proxy-allowlist.test.ts`                                                         |

---

## Files changed

### Documentation (DOCS task)

- ✅ `docs/app-development.md` — rewritten to cover both consume and deploy
  paths (AC-5.3)
- ✅ `docs/key-properties/multiple-deployments.md` — updated with injection
  contract and reserved-prefix rule
- ✅ `docs/recipes/README.md` — new; overview and test coverage guide
- ✅ `docs/recipes/anthropic-only.md` — new; allow/deny paths documented
- ✅ `docs/recipes/notion-read-only.md` — new; scoped token + allowlist pattern
- ✅ `docs/recipes/email-partial.md` — new; implicit-TLS port constraint
- ✅ `docs/playbooks/deploy-env.md` — updated with pointers to consume and
  deploy paths
- ✅ `docs/ai/status-m5.md` — this file

### Infrastructure config (INFRA-CONFIG task)

- `packages/infra/config/types.ts` — `env` widened to `string`; `FirstPartyEnv` type added
- `packages/infra/config/schema.ts` — new; `EnvConfigSchema`, `RESERVED_PREFIXES`, collision guards
- `packages/infra/config/schema.test.ts` — new; validation unit tests
- `packages/infra/config/index.ts` — loader refactored; third injection branch added
- `packages/infra/src/app-builder.ts` — new; `buildApp()` function (stack wiring moved here)
- `packages/infra/bin/app.ts` — thin shim over `buildApp` + `loadEnvConfig`
- `packages/infra/test/config.test.ts` — updated with injection test cases
- `packages/infra/test/synth-snapshot.test.ts` — new; zero-drift snapshot tests
- `packages/infra/test/synth-baseline.ts` — new; synth + normalize helper
- `packages/infra/test/__fixtures__/synth-baseline/dev.json` — baseline
  captured from the pre-refactor tree (commit a73a924, in-process
  `new App().synth()`, asset hashes normalized, WebStack pinned to
  placeholder mode)
- `packages/infra/test/__fixtures__/synth-baseline/prod.json` — baseline
  captured from the pre-refactor tree (commit a73a924, in-process
  `new App().synth()`, asset hashes normalized, WebStack pinned to
  placeholder mode)
- `packages/infra/package.json` — `zod` dependency added; `main`/`types`/`exports` added
  (package entrypoint) and a generic `deploy` script (`AV_CDK_ENV`-driven,
  mirroring the pre-existing `synth` script) added during integration so
  the "Simple case" custom-env deploy in app-development.md has a working
  command
- `packages/infra/index.ts` — new during integration; package entrypoint
  re-exporting `buildApp` and the config loader/schema/types for the
  "Advanced case" programmatic-import path
- `packages/infra/src/app-builder-suppressions.ts` — fixed during
  integration: the `AwsSolutions-IAM5` suppressions for the API and Runner
  stacks hardcoded `agent-village-dev`/`agent-village-prod` resource ARNs;
  a dependent deploy with a custom `prefix`/`env` produced unsuppressed
  cdk-nag findings and failed `cdk synth`. Now derived from `config.prefix`/
  `config.region`/`config.env`, matching how the stacks themselves name
  resources.

### Fixture and recipes (FIXTURE-RECIPES task)

- `examples/apply-bot/` — new; Python app fixture (manifest, agent, main.py, requirements.txt)
- `examples/apply-bot/platform-config/apply-bot.env.json` — new; injected EnvConfig
- `examples/anthropic-only/` — new; minimal allowlist fixture
- `examples/notion-reader/` — new; Notion API example (manifest, code)
- `packages/infra/test/apply-bot-fixture.test.ts` — new; manifest parsing + injection end-to-end
- `packages/services/src/sandbox-egress.test.ts` — new; derivation tests for all recipes
- `packages/infra/test/proxy-allowlist.test.ts` — updated; enforcement tests (allow + deny)
- `packages/cli/src/commands/consume-existing.test.ts` — new; consume smoke test
- `packages/cli/src/commands/doctor.ts` — pre-existing (Phase 5); not new to M5,
  `village env doctor` already worked and is now called out in
  app-development.md's cold-start pass

---

## How to read the docs

Start with [app-development.md](../app-development.md):

- **Path A** — for app builders consuming an existing platform.
- **Path B** — for operators deploying a custom platform instance.

For connectivity patterns, pick a recipe from `docs/recipes/`:

- [Anthropic-only](../recipes/anthropic-only.md) — LLM only.
- [Read-only Notion](../recipes/notion-read-only.md) — scoped API access.
- [Partial email](../recipes/email-partial.md) — IMAP/SMTP pattern.

---

## What was verified during integration

Every `<!-- verify-after-integrate -->` marker the three concurrent tasks left
in place has been resolved (claim checked against the landed code, marker
removed) or the underlying gap fixed:

- **JSON injection via `AV_ENV_CONFIG_PATH`** — confirmed working
  (`packages/infra/config/index.ts`), but with an important caveat the docs
  didn't originally spell out: it's only consulted for a non-`dev`/`prod`
  `--context env=` value — `dev`/`prod` always resolve to the checked-in
  config, by design. The "Simple case" example in app-development.md and the
  apply-bot example in multiple-deployments.md both used to instruct running
  `deploy:dev`/`synth:dev` (which hardcode `--context env=dev`) against a
  config with a **different** `env` name — silently ignoring the injected
  config with no error. Fixed: both docs (and `examples/apply-bot/README.md`)
  now use the env-var-driven `synth`/`deploy` scripts with `AV_CDK_ENV` set to
  match the config's `env`.
- **`buildApp(app, config)` export** — confirmed present
  (`packages/infra/src/app-builder.ts`), but not resolvable via `import {
buildApp } from '@agent-village/infra'` as the "Advanced case" instructed —
  the package had no `main`/`exports`/`types`. Fixed: added
  `packages/infra/index.ts` re-exporting `buildApp` + the config
  loader/schema/types, wired into `package.json`.
- **Doctor probe for API reachability** — `village env doctor` is real and
  pre-existing (Phase 5), not new to M5.
- **`synth:dev` / `deploy:dev` custom scripts** — exist and work for the
  first-party envs; a generic `deploy` script (mirroring the pre-existing
  `AV_CDK_ENV`-driven `synth` script) was added for the custom-env case the
  docs actually need.
- **Python dry-run test for apply-bot fixture** — passes
  (`packages/infra/test/apply-bot-fixture.test.ts`, gated on local `python3`).
- **All fixture example directories and their manifests** — present and
  parse as their respective schemas (`manifest.json` → `ApplicationManifest`,
  `agent.json` → `CreateAgentInput`).
- **cdk-nag suppressions for a custom prefix** — found broken during
  integration (not one of the original markers, but the same "believed to
  work, wasn't verified against a real custom-prefix synth" class of gap):
  `app-builder-suppressions.ts` hardcoded `agent-village-dev`/
  `agent-village-prod` resource ARNs. `apply-bot-fixture.test.ts`'s
  `buildApp()` call doesn't itself trigger cdk-nag (that only runs inside
  `app.synth()`, which the unit test never calls) — the bug only surfaced
  when actually running `cdk synth --context env=apply-bot` with
  `AV_ENV_CONFIG_PATH` set, exactly as an app builder following the "Simple
  case" would. Fixed by deriving the suppression ARNs from
  `config.prefix`/`config.region`/`config.env`; re-verified with the same
  credential-free `cdk synth` invocation (0 unsuppressed `AwsSolutions-*`
  findings, `apply-bot-*` stacks synthesize cleanly).

---

## Milestone readiness

✅ **DOCS, INFRA-CONFIG, FIXTURE-RECIPES, and integration all complete.**

Full suite, run at integration time:

| Check                                                                                       | Result                                                                                                                        |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                                                         | ✅ pass                                                                                                                       |
| `pnpm lint`                                                                                 | ✅ pass                                                                                                                       |
| `pnpm typecheck`                                                                            | ✅ pass                                                                                                                       |
| `pnpm test` (all packages)                                                                  | ✅ pass — 863 tests passed, 1 skipped (macOS lacks GNU `timeout`, pre-existing gate in `entrypoint.test.ts`, unrelated to M5) |
| `pnpm build`                                                                                | ✅ pass                                                                                                                       |
| `pnpm deps:check`                                                                           | ✅ pass — 0 errors (4 pre-existing orphan warnings, unrelated to M5)                                                          |
| `cdk synth --context env=dev` (credential-free)                                             | ✅ pass                                                                                                                       |
| `cdk synth --context env=apply-bot` + `AV_ENV_CONFIG_PATH` (credential-free, custom-prefix) | ✅ pass — 0 unsuppressed cdk-nag findings (was ~15 `AwsSolutions-IAM5` errors before the suppression fix above)               |

A fresh-context cold-start pass following `docs/app-development.md` literally
found and this integration fixed: the `deploy:dev`/`AV_ENV_CONFIG_PATH`
self-contradiction (both here and in `multiple-deployments.md` and
`examples/apply-bot/README.md`), the missing package entrypoint for the
"Advanced case" import, the cdk-nag suppression prefix bug above, the
`notion-read-only.md` grant-shape mismatch, the `anthropic-only.md` /
`notion-read-only.md` fictitious example-structure trees and invalid model
id, the undocumented `package-lock.json` prerequisite, the "no credentials
needed" framing gap around `anthropicApiKey`, and the undocumented
`village env doctor` / `village run --dry-run` subcommands.

---

## Next: M6 (Local dogfood + verdict)

M6 covers the manual dogfood and testing gates:

- AC-1.2 — Operator reconstructs a run's full audit trail.
- AC-1.4 — Audit playbook (`docs/playbooks/audit-a-run.md`) walked through.
- AC-3.2 — Account management playbook (`docs/playbooks/manage-accounts.md`).
- AC-5.5 — Cold-start doc-following test (app builder stands up a dependent instance).
- AC-7.1–7.4 — Three personas dogfood the UI locally (operator, app-builder, budget-victim).

Followed by M7: user-gated dev-AWS deploy + live dogfood.
