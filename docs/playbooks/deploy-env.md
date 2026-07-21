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

| Service         | Free tier covers                | After that                             |
| --------------- | ------------------------------- | -------------------------------------- |
| Lambda          | 1M invocations/mo               | ~$0.20 per million                     |
| DynamoDB        | 25 GB + 25 WCU/RCU on-demand    | Pennies per million requests           |
| CloudFront + S3 | ~1 TB egress/mo, 5 GB storage   | Pennies                                |
| Cognito         | 50k monthly active users        | $0.0055/MAU                            |
| CloudWatch Logs | 5 GB/mo ingest, 5 GB/mo storage | $0.50/GB                               |
| Secrets Manager | none                            | **$0.40/secret/month** (one per agent) |

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

Use **AWS CLI v2** — it can reuse your existing console sign-in, so you
never have to create or paste a long-lived access key.

```bash
# macOS
brew install awscli
# or download from https://aws.amazon.com/cli
```

The recommended `aws login` flow below needs a **recent** v2 — check
with `aws --version` and make sure it reports **2.32.0 or newer**
(`aws login` was added in 2.32.0; older v2 installs will reject it with
"Invalid choice"). `brew upgrade awscli` or re-running the installer
bumps it.

Then sign in. Pick whichever matches how you log into the console:

```bash
# Recommended (CLI ≥ 2.32.0): reuse your console credentials, no access
# key needed. Opens a browser to sign in, then caches a short-lived
# session the CLI auto-refreshes (up to 12h).
aws login

# If your org uses IAM Identity Center (SSO):
aws sso login

aws sts get-caller-identity   # should print your account id — confirms login
```

> **Permissions for `aws login`:** an IAM user needs the
> `SignInLocalDevelopmentAccess` managed policy attached (root users
> need nothing extra). Without it, `aws login` signs in but later
> commands fail with `AccessDenied`.

> **Last resort — static access keys.** If you can't upgrade the CLI or
> `aws login` isn't an option for you,
> you can `aws configure` and paste an access key/secret from your IAM
> user. This stores a long-lived credential on disk, so avoid it unless
> you have to, and rotate/delete the key when you're done.

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

### After this first deploy, three things to do

1. **Set `alarmEmail` to your address** in
   [`packages/infra/config/dev.ts`](../../packages/infra/config/dev.ts)
   (and `prod.ts`) before — or re-deploy after — the first deploy. The
   config ships with the repo owner's email.
2. **Confirm the alarm email.** AWS sends a "Subscription
   Confirmation" email to `alarmEmail`. **Click the "Confirm
   subscription" link** — until you do, no alerts will arrive. Same
   applies the first time you deploy prod.
3. **Wire the SPA to your Cognito pool, then ship a working bundle.** The
   web bundle reads its Cognito and API configuration at **build time**
   from Vite env vars, inlined into the JS at compile time — not read at
   runtime (see
   [`amplify-config.ts`](../../packages/web/src/auth/amplify-config.ts)).
   `pnpm build` above ran with none of these set — that does **not**
   produce the placeholder. It builds a real SPA bundle that just has no
   Cognito/API config baked in, so it deploys and loads fine but **sign-in
   silently does nothing** (`amplify-config.ts` only `console.warn`s and
   skips configuring Amplify). This is expected on the very first deploy
   and is not itself an error, but it's easy to mistake for "working"
   because the page renders. Fix it:
   - Using the stack outputs from the first deploy, set
     `VITE_COGNITO_USER_POOL_ID` (from `UserPoolId`),
     `VITE_COGNITO_CLIENT_ID` (from `UserPoolClientId`),
     `VITE_COGNITO_DOMAIN` (from the `-auth` stack's `UserPoolDomain`
     output), and `VITE_API_BASE_URL` (from `ApiEndpoint`) — e.g. in
     `packages/web/.env.local` for a local build.
   - Rebuild (`pnpm build`) so `packages/web/dist` now contains the
     config-bearing bundle, then re-deploy with the guard flag set:
     `AV_DEPLOY_WEB=1 pnpm --filter @agent-village/infra deploy:dev`.
     `AV_DEPLOY_WEB=1` makes `WebStack` **refuse to synth** if
     `packages/web/dist/index.html` is missing entirely, instead of
     silently shipping the placeholder over a real deploy — see the guard
     in `web-stack.ts` and its test,
     [`web-stack.test.ts`](../../packages/infra/src/stacks/web-stack.test.ts).
     Without the flag (e.g. plain `cdk synth` in a fresh checkout with no
     dist at all), a missing bundle only warns and falls back to the
     placeholder — that's what keeps `pnpm --filter @agent-village/infra synth`
     green in CI with no credentials and no built SPA.
   - **The `WebServingPlaceholder` stack output does not tell you whether
     sign-in works.** It only distinguishes "some dist directory shipped"
     (`"false"`) from "no dist directory existed, placeholder HTML shipped
     instead" (`"true"`). A config-less real bundle (this step, before you
     add the `VITE_*` vars) reports `"false"` even though sign-in is
     broken. To actually confirm sign-in works, open the deployed URL and
     check that a "Sign in" control appears and does something (or check
     the browser console for the "Cognito env vars missing" warning —
     its _absence_ is the signal you want).

### Tearing it back down

```bash
pnpm --filter @agent-village/infra exec cdk destroy --all --context env=dev
```

This prompts for confirmation per stack. Dev has
`retainOnDelete: false`, so it fully removes everything.
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
       "Statement": [
         {
           "Effect": "Allow",
           "Principal": {
             "Federated": "arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com"
           },
           "Action": "sts:AssumeRoleWithWebIdentity",
           "Condition": {
             "StringEquals": {
               "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
               "token.actions.githubusercontent.com:sub": "repo:<your-gh-username>/agent-village:environment:dev"
             }
           }
         }
       ]
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
4. After the first CI deploy succeeds, add these **Secrets** (per env —
   `_DEV` and `_PROD` suffixes), copied from the CDK stack outputs of that
   first deploy:
   - `AV_DEV_URL` / `AV_PROD_URL` = the CloudFront `WebUrl` output.
   - `VITE_COGNITO_USER_POOL_ID_DEV` / `_PROD` = the `-api` stack's
     `UserPoolId` output.
   - `VITE_COGNITO_CLIENT_ID_DEV` / `_PROD` = the `-api` stack's
     `UserPoolClientId` output.
   - `VITE_COGNITO_DOMAIN_DEV` / `_PROD` = the `-auth` stack's
     `UserPoolDomain` output.
   - `VITE_API_BASE_URL_DEV` / `_PROD` = the `-api` stack's
     `ApiEndpoint` output.

   `deploy.yml` feeds `AV_DEV_URL`/`AV_PROD_URL` to Playwright as
   `AV_E2E_BASE_URL` for the post-deploy smoke test, and feeds the
   `VITE_*` secrets to the **build** step so the SPA bundle bakes in
   working Cognito/API config before `cdk deploy` (with
   `AV_DEPLOY_WEB=1`) ships it — see
   [`deploy.yml`](../../.github/workflows/deploy.yml) and the
   chicken-and-egg note in [step 2](#after-this-first-deploy-three-things-to-do)
   above: `deploy.yml`'s Build step always runs `pnpm build` before
   `cdk deploy`, so **the very first CI-driven deploy of a fresh env ships
   a real but config-less SPA, not the placeholder** — these secrets
   don't exist until that first deploy's outputs exist, so the bundle
   builds successfully but sign-in silently does nothing. Add the secrets
   after deploy #1, then either re-run the workflow or just wait for the
   next push to `main` — deploy #2 ships a bundle with working sign-in.

---

## Routine deploys

| Env    | Trigger                                            | Workflow                                                             |
| ------ | -------------------------------------------------- | -------------------------------------------------------------------- |
| `dev`  | Push to `main`                                     | [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) |
| `prod` | Push a git tag `v*`, then approve in the GitHub UI | same file                                                            |

You can also trigger either manually: **Actions → Deploy → Run workflow**.

After CDK finishes, the workflow also builds the **sandbox base image**
([`packages/infra/sandbox-image/`](../../packages/infra/sandbox-image/),
ARM64 via QEMU) and pushes it to the env's ECR repo as `latest` + the git
SHA. The OIDC deploy role must be allowed to push to ECR —
`AdministratorAccess` (step 3a) covers it; if you tightened the role, add
`ecr:GetAuthorizationToken` plus push/pull on the
`agent-village-<env>-sandbox-base` repository.

---

## Verifying a deploy worked

1. **Workflow run** — green check on the commit/tag in GitHub Actions.
2. **Smoke E2E** — the workflow runs Playwright against the deployed
   URL (`AV_E2E_BASE_URL`, fed from the `AV_DEV_URL` / `AV_PROD_URL`
   secrets) after CDK finishes. Failure here means the infra is up but
   the SPA didn't load right.
3. **CloudFront URL** — open it. You should see the SPA, not the
   placeholder, **and** you should be able to actually sign in. A page
   that renders is not enough evidence on its own — see the next point.
4. **`WebServingPlaceholder` stack output** — `CloudFormation Console →
<prefix>-web stack → Outputs`. This tells you whether _any_ dist
   directory was deployed (`"false"`) or nothing was built at all and the
   fallback HTML shipped (`"true"`). **It does not tell you whether
   sign-in works** — a first deploy with no `VITE_*` secrets set still
   reports `"false"` even though sign-in is silently broken (see
   [step 2](#after-this-first-deploy-three-things-to-do)). To check
   sign-in itself: open the deployed URL's browser console and confirm
   there's no "Cognito env vars missing" warning, or just click "Sign in"
   and confirm it goes to Cognito's hosted UI instead of doing nothing.
   If `WebServingPlaceholder` is `"true"`, or sign-in doesn't work even
   though it's `"false"`, see [step 2](#after-this-first-deploy-three-things-to-do) /
   [3b](#3b-configure-github-repo-settings) above — you likely need to
   add or refresh the `VITE_*` secrets and redeploy.
5. **CloudFormation Console** — every stack should be `UPDATE_COMPLETE`
   or `CREATE_COMPLETE`, no `_ROLLBACK_`.

### CI (every PR and push to `main`) vs. deploy

Two separate GitHub Actions workflows, easy to conflate:

- **[`ci.yml`](../../.github/workflows/ci.yml)** runs on every PR and
  push, all as steps in one `verify` job: format, lint, typecheck, unit
  tests, `pnpm build`, a credential-free `cdk synth` (dev context, fake
  account/region — this is where the placeholder-fallback path in
  `web-stack.ts` is exercised), the dependency-cruiser structural check,
  and finally **mocked-auth E2E** (`pnpm exec playwright install` +
  `pnpm e2e`): `smoke.spec.ts` and
  `mvp.spec.ts`'s sign-in → create agent → run-now → replay happy path,
  driven against an in-memory mock auth session and mocked API routes —
  no deployed Cognito, no AWS credentials, no secrets required (see
  [`packages/web/e2e/README.md`](../../packages/web/e2e/README.md)).
  `phase3-sandbox.spec.ts` skips itself here (opt-in via `E2E_AWS=1`,
  needs a real deployment).
- **[`deploy.yml`](../../.github/workflows/deploy.yml)** (this section)
  actually deploys: builds with the real `VITE_*` secrets, `cdk deploy`,
  builds/pushes the sandbox and egress-proxy images, then runs the
  **smoke E2E against the deployed URL** (`AV_E2E_BASE_URL`) as a
  post-deploy check.

So a PR can be green without ever touching AWS, and a deploy re-validates
against the real, deployed stack afterward.

---

## Watching cost and health (everyday operation)

| What                      | Where to look                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| Current month's bill      | AWS Console → **Billing and Cost Management → Bills**                                         |
| Cost trend graphs         | AWS Console → **Billing → Cost Explorer**                                                     |
| Budget status             | AWS Console → **Billing → Budgets**. `MonitoringStack` creates `agent-village-<env>-monthly`. |
| Alarm state               | AWS Console → **CloudWatch → Alarms**                                                         |
| Per-agent Anthropic spend | The spend bar on the agent detail page in the SPA                                             |

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

In the AWS Console:

**EventBridge → Schedules → Schedule groups → `agent-village-<env>-agents`**
→ select each schedule → **Disable**.

This stops all scheduled runs without deleting anything. Re-enable when
you're ready to resume.
