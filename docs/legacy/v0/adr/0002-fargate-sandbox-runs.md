# ADR 0002: Sandboxed application runs on Fargate with S3-synced workspaces

Date: 2026-06-10
Status: Accepted

## Context

Phase 1 runs are a single Anthropic API call inside the runner Lambda. The
next class of workloads is containerized **agent applications**: long-running,
tool-using processes that need a real filesystem and CLI, durable state
between runs, and tightly limited access to the outside world (specific
Notion pages, gated email recipients) so a run never needs babysitting.

Options considered for the compute layer:

1. **ECS Fargate, launched per run** (chosen).
2. Self-hosted Daytona on EC2 — sub-second sandbox spin-up and a nice
   fs/process SDK, but an always-on stateful control plane + Docker host in
   an otherwise serverless, ~$0-idle system. Spin-up speed only matters for
   interactive sessions; our runs are scheduled.
3. Keep everything in Lambda — 15-minute ceiling, awkward filesystem, no
   per-run network identity.

Options considered for state between runs:

1. **Per-(user, agent) S3 prefix synced to `/workspace`** (chosen).
2. GitHub repo per (user, agent) — auditable diffs, but repo sprawl, a
   third-party system of record for user data, token/rate-limit management.
3. Long-lived sandboxes whose disks persist — state becomes an unbackedup
   pet on a host.

## Decision

- **Compute:** one ECS Fargate task per run, launched by the runner
  (EventBridge Scheduler keeps its existing role). NAT-less public-subnet
  VPC: NAT costs ~$32/mo idle; egress restriction comes from a proxy +
  security groups, not private networking.
- **State:** every (user, agent) pair owns the S3 prefix
  `{ownerSub}/{agentId}/` (see `workspacePrefix` in `@agent-village/shared`)
  in a **versioned** workspace bucket. Versioning supplies rollback/audit;
  lifecycle rules expire noncurrent versions.
- **Application contract:** apps build `FROM` the sandbox base image
  ([`packages/infra/sandbox-image/`](../../packages/infra/sandbox-image/)).
  Its entrypoint syncs the workspace down, execs the app, flushes
  periodically, and syncs back up even on failure — apps only ever see a
  plain `/workspace` directory. The
  [`ApplicationManifest`](../../packages/shared/src/schemas/manifest.ts)
  schema (image, schedule, egress allowlist, tool grants, flush interval)
  is the contract between an application and the platform.
- **Access limiting:** two layers. (a) Network egress allowlisted by domain
  via an egress proxy (CIDR rules can't track CDN-fronted APIs); (b)
  provider-native scoped credentials — Notion per-agent integrations, SES
  `ses:Recipients` IAM conditions, GitHub fine-grained PATs — injected as
  short-lived credentials per run. MCP is not required anywhere; tools are
  CLIs and files.

## Consequences

- The system stays ~$0 at idle: no always-on hosts, NAT gateways, or
  Daytona control plane. Fargate cold start (~30–60 s) is accepted because
  runs are scheduled, not interactive.
- A hard-killed task can lose writes since the last flush; the periodic
  flush bounds the window. One run at a time per agent becomes an invariant
  the launcher must enforce.
- Workspace deletion/retention is a prefix delete + lifecycle rule —
  user-data control stays first-party.
- ECS cannot be exercised by LocalStack free tier: the entrypoint is tested
  by stubbing the AWS CLI, infra by synth assertions, and the full loop only
  on dev.
- The launcher, egress proxy, and credential grants land in
  [phase-2-sandbox-runs](../phases/phase-2-sandbox-runs.md); until then the
  task definition exists but nothing launches it.

## Status

Accepted.
