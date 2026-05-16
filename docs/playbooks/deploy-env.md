# Playbook: deploy an environment

## One-time setup (per environment)

1. Bootstrap the AWS account for CDK:
   ```bash
   pnpm --filter @agent-village/infra exec cdk bootstrap aws://<account>/us-east-1
   ```
2. Create an IAM role for GitHub OIDC that trusts
   `repo:<owner>/agent-village:environment:<env>`. Grant only the actions
   needed for CDK deploys (`cloudformation:*`, `iam:PassRole`, etc.).
3. Set GitHub repo secrets:
   - `AWS_DEPLOY_ROLE_DEV` / `AWS_DEPLOY_ROLE_PROD` — role ARNs.
   - `AV_DEV_URL` / `AV_PROD_URL` — the deployed CloudFront URL (set after first deploy).
4. Create GitHub Environments `dev` and `prod`. Configure `prod` with a
   "Required reviewers" protection rule.

## Routine deploys

- **Dev:** every push to `main` deploys via `.github/workflows/deploy.yml`.
- **Prod:** push a git tag `v*`, then approve the deploy in the GitHub
  Actions UI. CDK runs with `--require-approval never` after the manual
  GitHub gate.

## Verifying a deploy

CloudWatch alarms (configured by `MonitoringStack`) page on errors.
The deploy workflow runs Playwright smoke tests against the deployed
URL after every deploy.

## Rolling back

CDK keeps the previous CloudFormation template. Roll back via the
CloudFormation console (`Update stack → Use previous template`) or by
re-deploying a previous git commit/tag.

## Emergency: pause all agents

```bash
# Until the CLI lands, use the AWS Console: EventBridge Scheduler →
# disable the schedule group "agent-village-<env>-agents".
```
