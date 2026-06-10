# Phase 2 — Sandboxed application runs

Goal: a containerized agent application runs on a schedule with a durable
`/workspace`, restricted egress, and scoped credentials — laptop off.
Architecture: [sandbox-runs](../architecture/sandbox-runs.md) ·
[ADR 0002](../adr/0002-fargate-sandbox-runs.md).

| Step | Deliverable                                                                                                                            | Status |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 01   | `ApplicationManifest` + `workspacePrefix` schemas in shared                                                                            | ✅     |
| 02   | Sandbox base image (workspace-sync entrypoint, tested against a stubbed AWS CLI)                                                       | ✅     |
| 03   | `SandboxStack`: versioned workspace bucket, ECR repo, NAT-less VPC + Fargate task                                                      | ✅     |
| 04   | Base-image build & push to ECR in the deploy workflow                                                                                  | ⬜     |
| 05   | Launcher: runner starts `RunTask` for manifest agents; per-run STS session policy scoped to `workspacePrefix`; one-run-per-agent guard | ⬜     |
| 06   | Run lifecycle for async runs: task state → Run record updates; `sandbox.run.*` events surfaced in the run viewer                       | ⬜     |
| 07   | Egress proxy (Fargate service) enforcing `egressAllow`; sandbox security group only reaches the proxy + DNS via the proxy              | ⬜     |
| 08   | Tool grants: SES recipient-conditioned creds, per-agent Notion integration secrets, GitHub fine-grained PATs — injected per run        | ⬜     |
| 09   | Manifest storage + API/UI: attach a manifest to an agent, show grants on the agent page                                                | ⬜     |

## Step notes

- **04** — `docker build --platform linux/arm64` (task definition is ARM64);
  tag `latest` plus the git SHA; push gated to `main` like the SPA deploy.
- **05** — launch via the existing runner Lambda so spend reservation and
  schedule handling stay one code path. The Anthropic key still goes to the
  app, but scoped to the run by Secrets Manager → STS injection, never baked
  into the task definition.
- **07** — until this step lands, sandbox tasks have unrestricted egress;
  do not attach grants to untrusted workloads before 07+08 are done.
- Steps 01–03 are deployed but inert: nothing launches the task definition
  until 05.

After each step: `pnpm lint && pnpm typecheck && pnpm test` stays green, and
`pnpm --filter @agent-village/infra synth:dev` must succeed without AWS
credentials.
