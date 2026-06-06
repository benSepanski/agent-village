# Playbook: deploy an environment

End-to-end walk-through for getting `agent-village` running on AWS.
Written for someone who's never used AWS before; skim the explanations if
you have. Estimated time the first time through: ~60 minutes (most of
which is waiting for CloudFront).

## What you'll have when you're done

- A real HTTPS URL serving the SPA (CloudFront).
- An API, scheduled Lambda runner, and DynamoDB table.
- A monthly budget cap ($5 dev / $20 prod) with email alerts at
  50 / 80 / 100% of the cap.
- CloudWatch alarms emailed to you on errors or runaway latency.
- GitHub Actions configured to auto-deploy on push to `main`.

## What will this cost?

When idle, this MVP runs almost entirely inside the AWS Free Tier:

| Service          | Free tier covers                  | After that                   |
| ---------------- | --------------------------------- | ---------------------------- |
| Lambda           | 1M invocations/mo                 | ~$0.20 per million           |
| DynamoDB         | 25 GB + 25 WCU/RCU on-demand      | Pennies per million requests |
| CloudFront + S3  | ~1 TB egress/mo, 5 GB storage     | Pennies                      |
| Cognito          | 50k monthly active users          | $0.0055/MAU                  |
| CloudWatch Logs  | 5 GB/mo ingest, 5 GB/mo storage   | $0.50/GB                     |
| Secrets Manager  | none                              | **$0.40/secret/month** (one per agent) |

The dominant cost in practice is the **Anthropic API itself**, which is
billed by Anthropic, not AWS. Each agent has its own `spendLimitUsd`
cap enforced in code — see [cost-guards](../architecture/cost-guards.md).

Worst case for a forgotten dev env: a few dollars/month from idle
secrets and log groups. The $5 monthly budget will email you long
before it gets worse.

---

## Prerequisites

### 1. An AWS account

If you don't have one: [aws.amazon.com/free](https://aws.amazon.com/free).
You need a credit card (Free Tier covers everything in this guide).

The email you sign up with becomes the **root user** — don't use it for
day-to-day work. After signup, create yourself an IAM user (or an IAM
Identity Center user) with `AdministratorAccess` and use that instead.
AWS's own getting-started guide walks you through this.

### 2. The AWS CLI installed and logged in

```bash
# macOS
brew install awscli
# or download from https://aws.amazon.com/cli

aws configure          # paste an access key/secret from your IAM user
# or, if your org uses IAM Identity Center:
aws sso login

aws sts get-caller-identity   # should print your account id — confirms login
```

### 3. Optional: a GitHub fork of this repo

Only needed if you want CI to auto-deploy. You can deploy by hand from
your laptop until then.

---

## Step 1 — Bootstrap CDK in your account (one-time)

> **What CDK is:** the AWS Cloud Development Kit. It turns the
> TypeScript in `packages/infra/` into CloudFormation templates and
> deploys them.
>
> **What "bootstrap" does:** creates a small set of helper resources
> (an S3 bucket for asset uploads, an IAM role CDK assumes during
> deploys) in your account. You run it once per AWS account/region
> pair.

```bash
pnpm install
pnpm --filter @agent-village/infra exec cdk bootstrap aws://<your-account-id>/us-east-1
```

You'll see a CloudFormation stack called `CDKToolkit` get created in
the AWS Console.

---

## Step 2 — First deploy from your laptop (recommended)

Before wiring up CI, deploy manually once to confirm everything works:

```bash
pnpm build                                              # build all workspace packages
pnpm --filter @agent-village/infra deploy:dev
```

First deploy takes ~10 minutes (CloudFront takes the longest). When it
finishes, CDK prints **stack outputs** — copy these somewhere:

- `WebUrl` — the CloudFront URL of your SPA.
- `ApiEndpoint` — the API Gateway URL.
- `UserPoolId` / `UserPoolClientId` — Cognito identifiers (the SPA
  uses these).
- `AlarmTopicArn` — the SNS topic alarms publish to.

### After this first deploy, two things to do

1. **Confirm the alarm email.** AWS sends a "Subscription
   Confirmation" email to `alarmEmail`
   ([`packages/infra/config/dev.ts`](../../packages/infra/config/dev.ts)).
   **Click the "Confirm subscription" link** — until you do, no alerts
   will arrive. Same applies the first time you deploy prod.
2. **Visit the `WebUrl`.** You'll see a "SPA bundle has not been built
   yet" placeholder until the web bundle is built and re-deployed —
   that ships in Phase 1.2.

### Tearing it back down

```bash
pnpm --filter @agent-village/infra exec cdk destroy --all --context env=dev
```

Dev has `retainOnDelete: false`, so this fully removes everything.
Prod's `retainOnDelete: true` keeps the DynamoDB table alive even if
the stack is destroyed.

---

## Step 3 — Wire up GitHub Actions (one-time, optional)

This lets CI deploy on push instead of running CDK from your laptop.

### 3a. Create an OIDC deploy role per environment

> **What OIDC is:** GitHub Actions can sign each workflow run with an
> OpenID Connect token. AWS verifies that token and lets the workflow
> assume an IAM role — **no long-lived AWS access key stored in the
> repo**.

In the AWS Console, do this twice — once for `dev`, once for `prod`:

1. **IAM → Identity providers → Add provider** (only needed once total,
   not per-env):
   - Provider type: `OpenID Connect`
   - Provider URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`
2. **IAM → Roles → Create role** → "Web identity":
   - Identity provider: the one you just created.
   - Audience: `sts.amazonaws.com`.
   - Edit the trust policy to restrict to **this repo's environment**:
     ```json
     {
       "Version": "2012-10-17",
       "Statement": [{
         "Effect": "Allow",
         "Principal": { "Federated": "arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com" },
         "Action": "sts:AssumeRoleWithWebIdentity",
         "Condition": {
           "StringEquals": {
             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
             "token.actions.githubusercontent.com:sub": "repo:<your-gh-username>/agent-village:environment:dev"
           }
         }
       }]
     }
     ```
     Use `:environment:prod` for the prod role's trust policy.
   - Attach permissions: for a personal MVP, `AdministratorAccess` is
     the simplest start. Tighten later (see
     [permissions/enforcement](../permissions/enforcement.md)).
   - Name it something like `agent-village-dev-deploy`.
3. Copy the **role ARN** (e.g.
   `arn:aws:iam::123456789012:role/agent-village-dev-deploy`).

### 3b. Configure GitHub repo settings

1. **Settings → Environments**:
   - Create `dev` (no protection rules needed).
   - Create `prod` and add a **"Required reviewers"** rule — this
     enforces the manual approval gate before prod deploys.
2. **Settings → Secrets and variables → Actions → Secrets**:
   - `AWS_DEPLOY_ROLE_DEV` = dev role ARN.
   - `AWS_DEPLOY_ROLE_PROD` = prod role ARN.
3. **Settings → Secrets and variables → Actions → Variables**:
   - `AV_DEPLOY_DEV_ENABLED` = `true`
     (gates the dev job — leave this unset until the dev role above
     exists, otherwise CI will fail noisily).
4. After the first CI deploy succeeds:
   - `AV_DEV_URL` = the CloudFront URL from the deploy outputs.
   - `AV_PROD_URL` = same, for prod (set after first prod deploy).

---

## Routine deploys

| Env    | Trigger                                            | Workflow                                                  |
| ------ | -------------------------------------------------- | --------------------------------------------------------- |
| `dev`  | Push to `main`                                     | [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) |
| `prod` | Push a git tag `v*`, then approve in the GitHub UI | same file                                                 |

You can also trigger either manually: **Actions → Deploy → Run workflow**.

---

## Verifying a deploy worked

1. **Workflow run** — green check on the commit/tag in GitHub Actions.
2. **Smoke E2E** — the workflow runs Playwright against
   `AV_DEV_URL` / `AV_PROD_URL` after CDK finishes. Failure here means
   the infra is up but the SPA didn't load right.
3. **CloudFront URL** — open it. You should see the SPA, not the
   placeholder.
4. **CloudFormation Console** — every stack should be `UPDATE_COMPLETE`
   or `CREATE_COMPLETE`, no `_ROLLBACK_`.

---

## Watching cost and health (everyday operation)

| What                  | Where to look                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| Current month's bill  | AWS Console → **Billing and Cost Management → Bills**                                          |
| Cost trend graphs     | AWS Console → **Billing → Cost Explorer**                                                      |
| Budget status         | AWS Console → **Billing → Budgets**. `MonitoringStack` creates `agent-village-<env>-monthly`.  |
| Alarm state           | AWS Console → **CloudWatch → Alarms**                                                          |
| Per-agent Anthropic spend | The agent detail page in the SPA (Phase 1)                                                 |

You'll also receive emails (at `alarmEmail`) when:

- Monthly spend crosses 50 / 80 / 100% of the budget.
- Runner Lambda errors > 0 in 5 min.
- Runner p95 latency > 30s.
- Any agent rejects a run because it hit `spendLimitUsd`.

Full breakdown: [cost-guards](../architecture/cost-guards.md) and
[observability](../architecture/observability.md).

---

## Rolling back

CDK preserves the previous CloudFormation template for every stack. Two
options:

- **CloudFormation Console** → pick the stack → **Update stack → Use
  previous template** → submit.
- **Re-deploy the previous commit/tag** — tag a previous commit and
  re-trigger the prod workflow.

---

## Emergency: pause all agents

Until the CLI command lands (Phase 2), use the AWS Console:

**EventBridge → Schedules → Schedule groups → `agent-village-<env>-agents`**
→ select each schedule → **Disable**.

This stops all scheduled runs without deleting anything. Re-enable when
you're ready to resume.
