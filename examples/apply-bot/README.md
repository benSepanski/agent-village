# apply-bot — reference application & dependent-deployment fixture

A realistic apply-bot-shaped Python app that doubles as the AC-5.4
"deploy-your-own-instance" fixture: it's both (1) an app you'd run against an
**existing** agent-village deployment (Path A in
[`docs/app-development.md`](../../docs/app-development.md)), and (2) proof
that a dependent repo can synth its **own** platform instance via config
injection, entirely without platform source changes (Path B).

## The app (Path A: consume an existing deployment)

Each run: read the curated `jobs.json` job list from the workspace, skip
anything already in `state.json`'s `appliedJobIds`, and — best-effort — ask
the metered Anthropic gateway for a one-line outreach note per new job (up to
`APPLY_BOT_MAX_PER_RUN`). State persists at
`<workspace>/apply-bot/state.json` and syncs to S3 like any other run.

| File               | Purpose                                                                 |
| ------------------ | ----------------------------------------------------------------------- |
| `main.py`          | The whole app. Standard library only — no `pip install` needed to run.  |
| `requirements.txt` | Empty by design (see the file); documents how to extend with real deps. |
| `manifest.json`    | The `ApplicationManifest` — Python image, job-board + PyPI egress.      |
| `agent.json`       | A `CreateAgentInput` starting point (replace the API key placeholder).  |

`manifest.image` is `"python"` — the custom-runtime tag built from
[`examples/python-sandbox-image`](../python-sandbox-image/) (`FROM` the
platform's sandbox base, `python3` installed). Push that image under your own
deployment's ECR repo before running this app; see that example's README.

### Lifecycle

```sh
village login
village agents create --file agent.json                 # prints agentId
village secrets set <agentId> jobboard-api-key           # if your job board needs one
village workspace push <agentId> examples/apply-bot --dest apply-bot
village agents manifest <agentId> examples/apply-bot/manifest.json
village run <agentId>
village logs <agentId> <runId> --follow
```

Seed `<workspace>/apply-bot/jobs.json` (a JSON array of
`{"id": "...", "title": "...", "company": "..."}`) via
`village workspace push` before the first meaningful run — an empty/missing
file is a safe no-op.

## The fixture (Path B: deploy your own instance via config injection)

`platform-config/apply-bot.env.json` is an `EnvConfig` for a **dependent**
deployment named `apply-bot` (not `dev`/`prod`) — proving AC-5.1/5.4: a repo
outside the platform can stand up its own fully-isolated instance (own
prefix, own budget, own resources) by injecting JSON, with zero platform
source changes.

```sh
export AV_ENV_CONFIG_PATH=examples/apply-bot/platform-config/apply-bot.env.json
export AV_CDK_ENV=apply-bot  # matches "env" in apply-bot.env.json; deploy/synth read --context env from this
export PATH=~/.nvm/versions/node/v22.19.0/bin:$PATH
pnpm install && pnpm build
pnpm --filter @agent-village/infra exec cdk bootstrap aws://<your-account>/us-east-1
pnpm --filter @agent-village/infra deploy
```

`deploy:dev`/`synth:dev` hardcode `--context env=dev` and would silently
ignore `AV_ENV_CONFIG_PATH`, redeploying the first-party dev config instead —
use the `AV_CDK_ENV`-driven `deploy`/`synth` scripts for an injected config.

This synths stacks named `apply-bot-data`, `apply-bot-api`, `apply-bot-auth`,
etc. — see
[`docs/key-properties/multiple-deployments.md`](../../docs/key-properties/multiple-deployments.md)
for the injection contract (reserved prefixes, uniqueness guarantees) and
[`packages/infra/test/apply-bot-fixture.test.ts`](../../packages/infra/test/apply-bot-fixture.test.ts)
for the automated proof (manifest/agent validity, injected-config synth, and
a gated end-to-end dry run of the sandbox entrypoint against this fixture's
`main.py`).

## Known limitations

- **Job-board integration is a stub.** `jobs.json` is operator-curated, not
  scraped — this fixture demonstrates the platform contract (workspace state,
  egress, secrets, metered LLM spend), not a production job-board client.
- **Model set** — the metering gateway only prices the platform's supported
  model ids; see [`examples/gmail-agent`](../gmail-agent/)'s README for the
  full list.
