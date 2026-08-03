# Phase 2 — Sandboxed application runs

Goal: a containerized agent application runs on a schedule with a durable
`/workspace`, restricted egress, and scoped credentials — laptop off.
Architecture: [sandbox-runs](../architecture/sandbox-runs.md) ·
[ADR 0002](../adr/0002-fargate-sandbox-runs.md).

| Step | Deliverable                                                                                                                                           | Status |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 01   | `ApplicationManifest` + `workspacePrefix` schemas in shared                                                                                           | ✅     |
| 02   | Sandbox base image (workspace-sync entrypoint, tested against a stubbed AWS CLI)                                                                      | ✅     |
| 03   | `SandboxStack`: versioned workspace bucket, ECR repo, NAT-less VPC + Fargate task                                                                     | ✅     |
| 04   | Base-image build & push to ECR in the deploy workflow                                                                                                 | ✅     |
| 05   | Launcher: runner starts `RunTask` for manifest agents; per-run STS session policy scoped to `workspacePrefix`; one-run-per-agent guard                | ✅     |
| 06   | Run lifecycle for async runs: task state → Run record updates; `sandbox.run.*` events surfaced in the run viewer                                      | ✅     |
| 07   | Egress proxy (per-run sidecar) enforcing `egressAllow` via in-task iptables + SNI/Host allowlist; see [ADR 0003](../adr/0003-egress-proxy-sidecar.md) | ✅     |
| 08   | Tool grants: SES recipient-conditioned creds, per-agent Notion integration secrets, GitHub fine-grained PATs — injected per run                       | ✅     |
| 09   | Manifest storage + API/UI: attach a manifest to an agent, show grants on the agent page                                                               | ✅     |

## Step notes

- **04** — done in [`deploy.yml`](../../.github/workflows/deploy.yml): QEMU +
  Buildx build for `linux/arm64` (the task definition is ARM64), pushed to the
  env's ECR repo as `latest` + the git SHA after CDK deploy. The OIDC deploy
  role needs ECR push permissions (covered by the playbook's default role).
- **05** — launch via the existing runner Lambda so spend reservation and
  schedule handling stay one code path. The Anthropic key still goes to the
  app, but scoped to the run by Secrets Manager → STS injection, never baked
  into the task definition. The launcher assumes the bucket-wide task role with
  an inline session policy scoped to `workspacePrefix` and injects the
  short-lived creds as container env (the task role's `maxSessionDuration` is
  2h so they outlive a max-length run). The one-run-per-agent guard is an
  atomic conditional write on the agent's `activeRunId`. Spend is reserved as a
  flat per-run Fargate estimate (`estimateSandboxCost`). **Known follow-up:**
  `manifest.image` is not yet used — `RunTask` can't override the container
  image, so the static base-image task definition runs the manifest's command
  against the synced workspace; honoring per-app images needs a
  `RegisterTaskDefinition` step.
- **06** — task completion is delivered by an EventBridge "ECS Task State
  Change" (STOPPED) rule → a lifecycle Lambda. The launcher stamps `runId` into
  `startedBy` and `agentId` into the task `group` (`av:<id>`); the lifecycle
  Lambda reads both back from the event, maps exit code / `stoppedReason` to a
  terminal status, patches the Run, and releases the `activeRunId` guard.
- **07** — the egress proxy is a **per-run sidecar** container in each sandbox
  task, not an always-on Fargate service ([ADR 0003](../adr/0003-egress-proxy-sidecar.md)
  supersedes ADR 0002's "proxy service" shape). This keeps the sandbox stack
  ~$0 at idle and NAT-less. The `egress-proxy` container holds `NET_ADMIN` and
  installs iptables NAT rules that transparently redirect the app container's
  outbound TCP into a small Node transparent proxy
  ([`proxy.mjs`](../../packages/infra/proxy-image/proxy.mjs)); the proxy peeks
  TLS SNI / HTTP Host and allows only the run's allowlist —
  AWS base domains (so `aws s3 sync` works) ∪ `manifest.egressAllow`
  ([`sandbox-egress.ts`](../../packages/services/src/sandbox-egress.ts)).
  Enforcement is intra-task iptables (containers in a Fargate task share one
  network namespace), not the security group, since the SG can't distinguish
  the two containers on the shared ENI.
- **08** — grants are resolved and injected per run in
  [`sandbox-grants.ts`](../../packages/services/src/sandbox-grants.ts). Notion /
  GitHub tokens are per-agent Secrets Manager secrets
  (`agent-village/<env>/agents/<agentId>/{notion-token,github-pat}`,
  [`grants.ts`](../../packages/data/src/secrets/grants.ts)) fetched and injected
  as env after an ownership check
  ([`assertGrantSecretOwned`](../../packages/domain/src/grants.ts) rejects a
  manifest naming another agent's/env's secret). SES sending is scoped by
  narrowing the per-run STS session policy with `ses:FromAddress` +
  `ForAllValues:StringLike ses:Recipients` conditions; the task-role SES ceiling
  and `EmailIdentity` are created only when `config.sesSenderDomain` is set, so
  SES grants are inert (send fails) in envs without a verified domain.
- **09** — a manifest is attached/detached through `UpdateAgentInput.manifest`
  (nullable: object attaches, `null` detaches, absent leaves untouched); storage
  already existed on the Agent record. The web agent page shows the manifest and
  its grants (read-only); the CLI adds `village agents manifest <id> [file]
[--detach]`.
- Steps 01–04 are deployed but inert: nothing launches the task definition
  until 05.

After each step: `pnpm lint && pnpm typecheck && pnpm test` stays green, and
`pnpm --filter @agent-village/infra synth:dev` must succeed without AWS
credentials.
