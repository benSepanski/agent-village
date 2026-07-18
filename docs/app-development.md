# Building an application on agent-village

The external view: everything you need to build, deploy, and operate an app
**from its own repo**, with agent-village as a dependency. An application is
a **separate GitHub repo** containing a manifest + the files the app needs at
runtime; the platform runs it on a schedule, sandboxed, with a hard spend cap.
The platform repo never changes for a new app
([roadmap north star](roadmap.md#north-star); reference app:
[`examples/gmail-agent`](../examples/gmail-agent/)).

## What you need once

1. **A deployed platform** and its outputs: the API URL, AWS region, and the
   `CliClientId` output of the auth stack (operator: [deploy-env](playbooks/deploy-env.md)).
2. **An account** — sign up in the web UI (Cognito email + password).
3. **The CLI** — from a platform checkout: `pnpm install && pnpm cli:pack`,
   then `npm i -g <tarball>`. Friends can install the same tarball; no AWS
   credentials are ever needed.
4. **Sign in** (flags are remembered in `~/.config/agent-village/config.json`):

```sh
village login --api-url https://<api-id>.execute-api.<region>.amazonaws.com \
  --region <region> --client-id <CliClientId>
```

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
- **`manifest.env` limits** — ≤20 entries, ≤2048-char values, UPPER*SNAKE
  names, `AV*`/`ANTHROPIC*`/`AWS*` prefixes reserved.

## Build → run lifecycle (all from your app repo)

```sh
village init my-app && cd my-app        # scaffold: manifest.json, app.mjs, agent.json, README
village agents create --file agent.json # prints the new agentId
village secrets set <agentId> my-secret # only if your manifest declares secret grants
village workspace push <agentId> . --dest my-app
village agents manifest <agentId> manifest.json
village run <agentId>
village logs <agentId> <runId> --follow
village agents show <agentId>           # spend, month-to-date, recent runs
```

Iterating is `village workspace push` + `village run`. Notes:

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

## Non-Node runtimes (Python etc.)

`manifest.image` names a tag in the platform's sandbox-base ECR repo. Build
`FROM` the base image, keep `USER 10001`, push the tag, set
`"image": "<tag>"` — see
[`examples/python-sandbox-image`](../examples/python-sandbox-image/) for the
worked recipe (this is the apply-bot path). Pushing the image is an operator
action (needs ECR access); everything else stays CLI-only.

## Interaction model

Runs are **batch**: there is no mid-run input channel. The pattern for
interactive-ish apps is _push input, then run_: write the input to a
workspace file (`village workspace push`), trigger `village run`, read the
output from the logs or a workspace file (`village workspace pull`). State
lives in workspace JSON between runs (see gmail-agent's watermark for the
at-most-once bookkeeping pattern worth copying).

## Fit of the driving apps

| App                                                 | Fit today                                                                                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **apply-bot** (job search, CV/cover-letter tailor)  | ✅ Ready: Python image via `manifest.image`, profile/roles via `manifest.env` + workspace files, job-board domains in `egressAllow`, session JSON in workspace, metered SDK spend.                                  |
| **D&D campaign assistant** (world state, NPC turns) | ✅ Ready with the batch model: campaign state in workspace JSON; DM pushes session notes → `village run` → pulls the prepared NPC actions. No live at-the-table loop (that's the daemon phase).                     |
| **Recipes / shopping-list bot**                     | ✅ Ready: weekly `schedule`, past lists in workspace, calendar via an ICS URL or API domain in `egressAllow` (+ a secret grant for the token).                                                                      |
| **OpenClaw-style always-on assistant**              | ❌ Not yet: needs a daemon runtime (long-lived service, inbound messages) — [phase 6+ sketch](phases/phase-2-plus.md). Interim: frequent scheduled runs against workspace state, but no push/real-time interaction. |

## Limits worth knowing up front

- `village workspace ls`/`pull` see the first 1000 files (one S3 page,
  flagged `truncated`) — vendor big dep trees at your own risk; prefer
  lockfile + in-sandbox install like the scaffold.
- STARTTLS never works through the egress proxy (implicit-TLS ports only).
- Non-secret manifest env rides ECS overrides (8 KiB total) — big config
  belongs in a workspace file.
- Secrets are per-agent, named leaves; the platform's own leaves
  (`anthropic-key` etc.) are reserved.
