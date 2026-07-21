# Building and deploying applications on agent-village

The external view: everything you need to build, deploy, and operate an app
**from its own repo**, with agent-village as a dependency. An application is
a **separate GitHub repo** containing a manifest + the files the app needs at
runtime; the platform runs it on a schedule, sandboxed, with a hard spend cap.

This guide covers **two paths**: (A) consume an existing deployed platform, and
(B) deploy your own platform instance for your app.

---

## Path A: Consume an existing deployment

Use this path if an operator has already deployed agent-village and wants you to
build and run apps on it. You never touch the platform repo or AWS — but you
do need your own Anthropic API key: `agent.json` requires a real
`anthropicApiKey` per agent (stored server-side; runs only ever see gateway
tokens, never the key itself), and each agent's Claude usage settles against
_that_ key's Anthropic billing, capped by the agent's own `spendLimitUsd`.
There is no platform-wide shared key — ask your operator if they intend to
cover the cost of your key, or budget for it yourself.

### 1. Get deployment coordinates from your operator

The operator has deployed agent-village and controls the platform instance. Ask
them for these three pieces of information (they can find them in AWS CloudFormation stack outputs):

| Value         | Where to find it (operator)                                           | Example                                              |
| ------------- | --------------------------------------------------------------------- | ---------------------------------------------------- |
| `--api-url`   | API Gateway endpoint; stack `<prefix>-api`, output `ApiEndpoint`      | `https://abc123.execute-api.us-east-1.amazonaws.com` |
| `--region`    | The AWS region where the deployment lives                             | `us-east-1`                                          |
| `--client-id` | Cognito User Pool Client; stack `<prefix>-auth`, output `CliClientId` | `3abc5def...` (36-char UUID)                         |

If you want to query AWS directly (you'll need CLI access):

```bash
# Fetch the API endpoint
aws cloudformation describe-stacks \
  --stack-name <prefix>-api \
  --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
  --output text

# Fetch the Cognito client id
aws cloudformation describe-stacks \
  --stack-name <prefix>-auth \
  --query "Stacks[0].Outputs[?OutputKey=='CliClientId'].OutputValue" \
  --output text
```

### 2. Install the CLI and sign in

From a platform checkout:

```bash
pnpm install && pnpm cli:pack
npm i -g <path-to-tarball>
```

Or ask your operator for the pre-built tarball — it can be shared with anyone.
No AWS credentials are ever needed for CLI users.

Then sign in with the coordinates your operator gave you (flags are remembered in `~/.config/agent-village/config.json`):

```bash
village login --api-url https://<api-id>.execute-api.<region>.amazonaws.com \
  --region <region> --client-id <CliClientId>
```

This prompts for an email and password (existing user or signup).

> `village env doctor` checks that your local setup (config file, stored
> token, keychain access) is ready before you go further — worth running
> here if `login` or the next steps behave unexpectedly.

### 3. Build your app

Create a new directory:

```bash
village init my-app && cd my-app
```

This scaffolds:

- `manifest.json` — your app's contract with the platform
- `agent.json` — the agent definition (name, spend limit, schedule, etc.)
- `app.mjs` — starter code (JavaScript)
- `package.json` — declares the `@anthropic-ai/sdk` dependency `app.mjs` uses
- `.gitignore` — ignores `node_modules`
- `README.md` — the app template

Adapt them to your needs (see [The app contract](#the-app-contract) below).
Replace the `anthropicApiKey` placeholder in `agent.json` with a real key,
and generate a lockfile before your first run — the scaffolded
`manifest.json`'s `command` runs `npm ci --omit=dev` inside the sandbox,
which fails without one:

```bash
npm install --package-lock-only
```

### 4. Upload and run

```bash
# Create the agent on the platform
village agents create --file agent.json  # prints the agentId

# Set up any secrets your manifest declares
village secrets set <agentId> my-secret-name

# Upload your initial workspace (code, data, config files)
village workspace push <agentId> . --dest my-app

# Bind the manifest to the agent
village agents manifest <agentId> manifest.json

# Trigger a run
village run <agentId>

# Watch the logs
village logs <agentId> <runId> --follow
```

Iterate with `village workspace push` + `village run`. `village run <agentId>
--dry-run` skips the Anthropic call (caps `max_tokens` at 256) — a cheap way
to check the manifest/workspace/egress wiring before spending real money.
Notes:

- `agent.json` needs `name`, `model`, `systemPrompt`, `schedule`,
  `spendLimitUsd`, and `anthropicApiKey` (the real key, stored server-side;
  runs only ever see gateway tokens). The **agent-level** `schedule` drives
  runs (`rate(...)`/`cron(...)`); `manifest.schedule` is informational.
- `village workspace push` copies the _contents_ of the directory to `--dest`;
  the manifest `command` copies `/workspace/my-app` to `/tmp` and runs there
  so `node_modules` never syncs back to S3.
- Don't push while a run is active — the run's final sync-back can overwrite
  yours. `village agents show` tells you if one is running.
- `village workspace pull <agentId>` fetches the whole workspace (state
  files included) for debugging; `ls`/`rm` round it out.

---

## Path B: Deploy your own platform instance

Use this path if you want to deploy agent-village yourself and control the
infrastructure (e.g. for a team, a dedicated environment, or a fork with
custom changes). This requires AWS and CDK; the deployment is fully described
in [`docs/playbooks/deploy-env.md`](playbooks/deploy-env.md).

### Quick summary

1. **Bootstrap CDK** (once per AWS account/region):

   ```bash
   pnpm install
   pnpm --filter @agent-village/infra exec cdk bootstrap aws://<account-id>/us-east-1
   ```

2. **Inject your configuration** (either path below, depending on your setup):

   **Simple case — use a JSON config file:**

   ```bash
   export AV_ENV_CONFIG_PATH=path/to/my-config.json
   export AV_CDK_ENV=my-env-name    # must match "env" in my-config.json — see note below
   export PATH=~/.nvm/versions/node/v22.19.0/bin:$PATH
   pnpm build
   pnpm --filter @agent-village/infra deploy
   ```

   Your `my-config.json` must contain:

   ```json
   {
     "env": "my-env-name",
     "prefix": "my-prefix",
     "region": "us-east-1",
     "retainOnDelete": false,
     "runnerMemoryMb": 512,
     "apiMemoryMb": 256,
     "logRetentionDays": 7,
     "sandboxTaskCpu": 256,
     "sandboxTaskMemoryMb": 512,
     "monthlyBudgetUsd": 5,
     "budgetDriftThresholdUsd": 1,
     "alarmEmail": "your-email@example.com"
   }
   ```

   > `AV_ENV_CONFIG_PATH` is only consulted for a `--context env=<name>` value
   > that is **not** `dev`/`prod` — those two are always the checked-in configs
   > in `packages/infra/config/`, by design (a dependent deploy can never
   > silently override the first-party environments). That's what
   > `AV_CDK_ENV` controls here: `deploy`/`synth` resolve their `--context
env=` from `AV_CDK_ENV` (default `dev`), so it must be set to the same
   > name as `my-config.json`'s `"env"` field. Using `deploy:dev`/`synth:dev`
   > instead (which hardcode `--context env=dev`) silently ignores
   > `AV_ENV_CONFIG_PATH` and re-deploys the first-party dev config — no
   > error, no warning.

   **Advanced case — fork the repo and use TypeScript config:**

   Edit `packages/infra/config/` to add your own config, or import `buildApp` +
   `EnvConfigSchema` from `@agent-village/infra` in your own `bin/app.ts` and
   construct the config programmatically (e.g. reading from environment variables
   or a computed value).

3. **After deploy**, capture the stack outputs (API endpoint, Cognito client ID, etc.)
   and use **Path A** above to build apps on your deployed platform, or iterate on
   the platform code itself.

Full details: [`docs/playbooks/deploy-env.md`](playbooks/deploy-env.md).

---

## The app contract

Your app is a command run inside a Fargate sandbox. With zero app-side code
it gets:

| The platform injects                          | Meaning                                                                                                                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/workspace` (override: `AV_WORKSPACE_DIR`\*) | Durable per-agent directory: synced down from S3 before start, flushed every `manifest.flushIntervalSeconds` (0 = only at exit), synced back on exit/failure/SIGTERM. Keep state here.   |
| `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY`    | Metered LLM access. The SDK honors these automatically; every call goes through the spend gateway and counts against the agent's `spendLimitUsd`. The real key never enters the sandbox. |
| `manifest.env`                                | Your plain (non-secret) config map, injected as-is.                                                                                                                                      |
| Secret grants                                 | `{"kind":"secret","name":"<leaf>","env":"MY_VAR"}` injects the value stored via `village secrets set <agentId> <leaf>`.                                                                  |
| `AV_TIMEOUT_SECONDS`                          | Informational copy of the kill-switch budget.                                                                                                                                            |

\* `AV_WORKSPACE_DIR` is an app-side convention (default `/workspace`) — the
entrypoint's sync uses `AV_WORKSPACE_URI`, which is platform-reserved.

And it is subject to:

- **Egress allowlist** — outbound TCP only to AWS endpoints ∪
  `manifest.egressAllow` (exact hostnames or `*.wildcards`; any port, but the
  proxy peeks TLS SNI/HTTP Host, so implicit TLS only — **no STARTTLS**, e.g.
  Gmail must use ports 993/465, not 143/587).
- **Spend cap** — LLM + compute spend settle against `spendLimitUsd`; the
  gateway starts rejecting calls when it's exhausted. Only the platform's
  priced model ids are accepted (see the gmail-agent README for the current
  set).
- **Kill switch** — the run is stopped at `manifest.timeoutMinutes`.
- **One run at a time** — per agent; a second trigger while one is running
  is rejected. The in-flight run is the only writer to the workspace.
- **`manifest.env` limits** — ≤20 entries, ≤2048-char values,
  `UPPER_SNAKE_CASE` names, `AV_` / `ANTHROPIC_` / `AWS_` prefixes reserved.

---

## Non-Node runtimes (Python etc.)

`manifest.image` names a tag in the platform's sandbox-base ECR repo. Build
`FROM` the base image, keep `USER 10001`, push the tag, set
`"image": "<tag>"` — see
[`examples/python-sandbox-image`](../examples/python-sandbox-image/) for the
worked recipe. Pushing the image is an operator action (needs ECR access);
everything else stays CLI-only.

---

## Interaction model

Runs are **batch**: there is no mid-run input channel. The pattern for
interactive-ish apps is _push input, then run_: write the input to a
workspace file (`village workspace push`), trigger `village run`, read the
output from the logs or a workspace file (`village workspace pull`). State
lives in workspace JSON between runs (see gmail-agent's watermark for the
at-most-once bookkeeping pattern worth copying).

---

## Fit of the driving apps

| App                                                 | Fit today                                                                                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **apply-bot** (job search, CV/cover-letter tailor)  | ✅ Ready: Python image via `manifest.image`, profile/roles via `manifest.env` + workspace files, job-board domains in `egressAllow`, session JSON in workspace, metered SDK spend.                                  |
| **D&D campaign assistant** (world state, NPC turns) | ✅ Ready with the batch model: campaign state in workspace JSON; DM pushes session notes → `village run` → pulls the prepared NPC actions. No live at-the-table loop (that's the daemon phase).                     |
| **Recipes / shopping-list bot**                     | ✅ Ready: weekly `schedule`, past lists in workspace, calendar via an ICS URL or API domain in `egressAllow` (+ a secret grant for the token).                                                                      |
| **OpenClaw-style always-on assistant**              | ❌ Not yet: needs a daemon runtime (long-lived service, inbound messages) — [phase 6+ sketch](phases/phase-2-plus.md). Interim: frequent scheduled runs against workspace state, but no push/real-time interaction. |

---

## Connectivity recipes

Each recipe demonstrates a specific connectivity pattern:

- **[Anthropic-only](recipes/anthropic-only.md)** — reach the metering gateway only (no external APIs).
- **[Read-only Notion](recipes/notion-read-only.md)** — scoped token + egress allowlist.
- **[Partial email](recipes/email-partial.md)** — IMAP/SMTP with implicit TLS (no STARTTLS).

---

## Limits worth knowing up front

- `village workspace ls`/`pull` see the first 1000 files (one S3 page,
  flagged `truncated`) — vendor big dep trees at your own risk; prefer
  lockfile + in-sandbox install like the scaffold.
- STARTTLS never works through the egress proxy (implicit-TLS ports only).
- Non-secret manifest env rides ECS overrides (8 KiB total) — big config
  belongs in a workspace file.
- Secrets are per-agent, named leaves; the platform's own leaves
  (`anthropic-key` etc.) are reserved.
