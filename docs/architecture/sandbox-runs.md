# Sandboxed application runs

How a containerized agent application runs with durable state and limited
access. Decision record: [ADR 0002](../adr/0002-fargate-sandbox-runs.md).
Rollout status: [phase-2-sandbox-runs](../phases/phase-2-sandbox-runs.md).

## The contract with an application

An application is a **container image + an
[`ApplicationManifest`](../../packages/shared/src/schemas/manifest.ts)**
(image, command, schedule, egress allowlist, tool grants, flush interval).

The image builds `FROM` the sandbox base image
([`packages/infra/sandbox-image/`](../../packages/infra/sandbox-image/)) and
gets, with zero app-side code:

- **`/workspace` is durable.** The base-image entrypoint syncs the agent's
  S3 prefix down before the app starts, flushes every `flushIntervalSeconds`
  (default 300, 0 disables), and syncs back up after the app exits — also on
  failure and on SIGTERM. The app just reads and writes files.
- **Run bracketing.** The entrypoint emits `sandbox.run.*` structured-log
  events (sync_down → app_exited → sync_up) with the app's exit code, so the
  run record needs no cooperation from the app.

## Workspace = S3 prefix

`{ownerSub}/{agentId}/` (`workspacePrefix()` in shared) in a **versioned**
bucket owned by the `SandboxStack`:

- Versioning gives per-run rollback/audit; noncurrent versions expire via
  lifecycle rule (30 d dev / 90 d prod).
- Isolation is IAM: the task role is bucket-wide (the ceiling); the launcher
  narrows each run to exactly its prefix with an STS session policy.
- A run in flight is the only writer to its prefix — the launcher enforces
  one concurrent run per agent.

## Compute path (target state)

```
EventBridge Scheduler ──▶ Lambda(runner)
                              │  manifest? ──▶ ECS RunTask (Fargate, per-run)
                              │                   │  sandbox container
                              │                   ├─▶ S3 workspace prefix (scoped STS)
                              │                   ├─▶ egress proxy ──▶ allowlisted domains
                              │                   └─▶ stdout ──▶ CloudWatch Logs
                              └─ no manifest ──▶ Phase-1 inline Anthropic call
```

The cluster lives in a NAT-less public-subnet VPC (NAT ≈ $32/mo idle —
see [cost-guards](cost-guards.md)); everything is ~$0 with no run active.

## Access limiting (two layers)

1. **Network:** the sandbox's only route out is the egress proxy, which
   enforces the manifest's domain allowlist (`egressAllow`). CIDR security
   groups can't track CDN-fronted APIs; domains can.
2. **Credentials:** provider-native scoping per grant — Notion integration
   tokens only see pages shared with them; SES sending is constrained by
   `ses:Recipients` / `ses:FromAddress` IAM conditions; GitHub uses
   fine-grained per-repo PATs. Injected per run, short-lived where the
   provider allows. No MCP required: tools are CLIs and files.

Residual risk to check per manifest: an agent that reads untrusted input
**and** holds any outbound grant can be steered by that input. The grants
cap the blast radius; review the combination, not each grant alone.
