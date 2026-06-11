# ADR 0001: TypeScript everywhere, AWS CDK, DynamoDB single-table

Date: 2026-05-16
Status: Accepted

## Context

Agent Village is a greenfield personal SaaS for scheduled AI agents. The
owner wants to learn AWS hosting, cost management, and CI/CD while
maintaining harness-engineering AI-fidelity (OpenAI's Feb 2026 article).

Stack candidates considered:

1. **TypeScript everywhere + AWS CDK** (chosen).
2. Python backend + TypeScript frontend + AWS CDK.
3. TypeScript everywhere + Terraform (HCL) for IaC.

Database candidates considered:

1. Aurora Serverless v2 Postgres.
2. **DynamoDB** (chosen).
3. RDS Postgres `db.t4g.micro`.
4. External: Neon or Supabase Postgres.

## Decision

- **Language:** TypeScript (strict) across frontend, backend, IaC, and CLI.
  One toolchain. Types shared between FE and BE via `packages/shared/`.
  Strong typing is load-bearing for harness-engineering — agents reason
  better about a typed codebase.
- **IaC:** AWS CDK v2 (TypeScript). Same language as the app; type-checked
  infrastructure; AWS-native learning surface; `cdk-nag` provides security
  feedback at synth time.
- **Database:** DynamoDB, single-table. Always-free 25 GB covers personal use;
  pay-per-request mode means no idle capacity to forget about. Trade-off
  acknowledged: requires up-front access-pattern thinking and is less
  transferable to non-AWS work — accepted because cost dominates this project.
- **Frontend:** Vite + React SPA hosted on S3 + CloudFront.
- **Auth:** Cognito User Pool with Google federation.
- **Runtime:** Node 22 Lambda + API Gateway HTTP API; EventBridge Scheduler
  for per-agent cron.

## Consequences

- All access patterns must be designed into the DynamoDB key schema up
  front. See [docs/data-model/](../data-model/README.md).
- Any future need for ad-hoc SQL-style analytical queries will require
  exporting to S3/Athena.
- The `cli` and `services` packages share code with `runner` and `api`,
  which keeps the deployed Lambda and local-machine behavior in lockstep.
- Strict ESLint bounds (complexity 10, function 50 lines, file 300 lines)
  will sometimes force extraction of small helpers. This is the intended
  cost; suppressing the rules is forbidden by `permissions.md`.

## Status

Locked. Any deviation requires a superseding ADR.
