# Phase 4 — apply-bot enablement

Goal: remove the three platform blockers the [roadmap](../roadmap.md) lists for
running **apply-bot** (a Python job-search agent, sibling repo `~/src/apply-bot`)
as a one-off manifest app: plain (non-secret) manifest config, a user-facing way
to store agent secrets, and honoring `manifest.image` so a Python-capable image
can run in the sandbox. Same shape as [`examples/gmail-agent`](../../examples/gmail-agent/)
— the platform ships general capabilities; apply-bot itself stays a one-off app
(its port is a separate, later effort in its own repo).

This phase renumbers the [4+ sketch](phase-2-plus.md): notifications and the
rest shift down one; the three "smaller backlog items" Phase 3 surfaced are this
phase's steps 01–02.

| Step | Deliverable                                                                                                                                                           | Status |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 01   | `manifest.env`: validated plain env map injected into the app container; gmail-agent's non-secret config moves off secret grants                                      | 📋     |
| 02   | Agent-secrets API + CLI: `POST/GET/DELETE /agents/{id}/secrets[/{name}]` wiring `storeAgentSecret`; `village secrets set/list/rm`; agent delete cleans up its secrets | 📋     |
| 03   | `manifest.image` honored: a non-base image tag launches via a per-image task definition cloned from the static one; Python image recipe example                       | 📋     |

## Step notes

- **01 — `manifest.env`.** Add `env` to `ApplicationManifest`
  (`packages/shared/src/schemas/manifest.ts`): a record of at most 20 entries,
  keys validated exactly like `SecretGrant.env` (`ENV_NAME_REGEX` +
  `!isReservedSandboxEnv`), values plain strings capped at 2048 chars (ECS
  `RunTask` overrides carry the whole map and have an 8 KiB total limit).
  A manifest-level `superRefine` rejects an `env` key that collides with any
  secret grant's `env` (extending the existing duplicate-secret-env check —
  ECS applies the last duplicate, so collisions must be impossible, not
  resolved by ordering). Injection: `buildEnvironment`
  (`packages/services/src/sandbox.ts`) appends the map **after** the platform
  block and **before** `grantEnv`; reserved-name validation makes platform
  collisions unrepresentable, the superRefine makes grant collisions
  unrepresentable. Web: a read-only env block in `ManifestSection.tsx` (values
  are non-secret by construction; still render them as code, not prose).
  Validation of the feature: `examples/gmail-agent` moves `gmail-address` and
  `gmail-allowed-senders` from `secret` grants to `manifest.env` (the app
  password stays a secret grant); its README drops the two now-unneeded
  `aws secretsmanager` provisioning steps.

- **02 — agent-secrets API + CLI.** Wires the existing data layer
  (`grantSecrets.storeAgentSecret` / `deleteAgentSecret`,
  `agent-village/<env>/agents/<agentId>/<leaf>` naming) to users. Service
  layer `packages/services/src/agent-secrets.ts`: every operation first loads
  the agent via `agentRepo.getAgent(ownerSub, agentId)` (the prefix-ownership
  assert alone does **not** prove the caller owns the agent), validates the
  leaf with `SECRET_NAME_REGEX` + `!isReservedSecretLeaf` (without this a user
  could overwrite the platform's `anthropic-key` and bypass the metering
  gateway — the collision is exact: `agentSecretName(id,'anthropic-key',env)`
  is the platform key's path), and derives names only via
  `agentSecretName`/`agentSecretPrefix`. Routes (all methods already in the
  CLI client + CORS set — no `PUT`): `POST /agents/{id}/secrets` with
  `{name, value}` (create-or-update, returns `{name, arn}`, never echoes the
  value — and keeps the `value` schema plain `z.string()` so Zod issues can't
  embed value text in a 400), `GET /agents/{id}/secrets` (names only), `DELETE
/agents/{id}/secrets/{name}` (204). Listing needs a new data-layer
  `listAgentSecrets` (`ListSecretsCommand` filtered on the agent prefix);
  `secretsmanager:ListSecrets` is only grantable on `*`, so the GET handler
  gets a dedicated grant + a documented IAM5 `Resource::*` suppression (dev +
  prod spellings) in `packages/infra/bin/app.ts`. `deleteAgent` gains
  list-and-delete of the agent's secret prefix, closing the existing
  orphaned-grant-secrets gap. CLI: `village secrets set <agentId> <name>`
  (value via `--value`, `--from-file`, or stdin — never a positional arg),
  `list`, `rm`; output prints names/ARNs only. Handler tests must extend the
  `vi.hoisted` services mock in `handlers.test.ts` (a missing key crashes at
  import), CLI tests the `fakeClient` in `commands.test.ts`.

- **03 — `manifest.image`.** Contract: `image` is an **image tag in the
  platform's sandbox-base ECR repo**, not a free URI — the schema tightens to
  a tag regex (`^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$`; the one known stored
  value, `sandbox-base`, matches). The literal `sandbox-base` keeps meaning
  "the static task definition" (current behavior). Any other tag must name an
  image **built `FROM` the base image** (entrypoint contract: workspace sync,
  `timeout` wrapping, uid 10001) and pushed to the base repo — this keeps the
  execution role's pull permissions and ADR 0003's posture unchanged, and is
  exactly the apply-bot path: build a Python-capable image `FROM` base, push
  as `:apply-bot`, set `manifest.image`.

  Launcher (`packages/services/src/sandbox.ts`): a `resolveTaskDefinition`
  step before `runTask`. For a custom tag it **clones the static definition
  via `DescribeTaskDefinition`** — drift-proof: roles, log config, proxy
  sidecar, healthcheck, `dependsOn HEALTHY`, uid 10001, stopTimeout, ARM64
  all come from the deployed source of truth rather than a hand-maintained
  copy — swaps only the app container's image tag, strips the read-only
  response fields, and re-registers under the **same family**
  (`<prefix>-sandbox`), so the existing family-scoped `ecs:RunTask` and
  `iam:PassRole` grants match without widening. Same cpu/memory, so
  `sandboxEstimate`/`reconcileComputeSpend`'s single-task-size assumption
  holds. Reuse: the resolved ARN is cached on the Agent record
  (`sandboxTaskDef: {image, baseArn, arn}`, an internal field **not** exposed
  through `CreateAgentInput`/`UpdateAgentInput`), keyed on the tag and the
  static def's revision ARN so a platform redeploy re-clones; stale revisions
  are left ACTIVE (revisions are free; deregistration adds lifecycle IAM for
  no safety gain — revisit if clutter matters). IAM:
  `ecs:RegisterTaskDefinition` + `ecs:DescribeTaskDefinition` on the runner
  (Register supports no resource scoping → `Resource:*` with a documented
  IAM5 suppression, dev + prod). Tests: unit tests on the clone function
  asserting the posture survives (uid, container names `app`/`egress-proxy` —
  the lifecycle handler and proxy override look containers up by name —
  NET_ADMIN only on the proxy, dependsOn HEALTHY, log group), plus
  launch-path tests for cache hit/miss/stale. A worked Python image recipe
  lands as `examples/python-sandbox-image/Dockerfile` (FROM base, installs
  python3 + pip, keeps USER 10001) — the apply-bot unblock in miniature.

After each step: `pnpm lint && pnpm typecheck && pnpm test` stays green, and
`pnpm --filter @agent-village/infra synth:dev` must succeed without AWS
credentials.
