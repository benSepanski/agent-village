# gmail-agent — reference application

An agent with its own Gmail inbox, built as a **one-off manifest app with zero
platform changes** (Phase 3, step 08). A plain Node script (ESM, no build
step) that runs on the static sandbox base image:

1. **Poll** — connects to `imap.gmail.com:993` (implicit TLS) and fetches
   messages newer than a UID watermark persisted in the synced `/workspace`
   directory.
2. **Draft** — calls the Anthropic API via `@anthropic-ai/sdk`. The SDK
   honors the `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` the platform injects
   per run, so every call goes through the metering gateway and counts
   against the agent's `spendLimitUsd` — the real key never enters the
   sandbox.
3. **Reply** — sends via `smtp.gmail.com:465` (SMTPS), updates the watermark,
   exits. The workspace (including the state file) syncs back to S3.

Everything the platform ships is exercised: workspace persistence, the
generic `secret` grant, host-based egress allow-listing on real ports
(993/465/443), metered LLM spend, the run-duration kill switch, and log
tailing.

## Application-level guards (in the script, not the platform)

- **Sender allowlist** — only addresses in `GMAIL_ALLOWED_SENDERS` get
  replies; everything else is logged and skipped. Fail-closed: the env var is
  required.
- **Loop suppression** — messages carrying `Auto-Submitted` (other than
  `no`), `Precedence: bulk/junk/list`, `X-Auto-Response-Suppress`, or
  `List-Id` are never answered, and outgoing replies set
  `Auto-Submitted: auto-replied` (RFC 3834) so other responders — including
  future runs of this script — never answer them. Mail from the agent's own
  address is skipped.
- **At-most-once replies** — the UID watermark is persisted _before_ each
  send, so a crash loses at most one reply instead of duplicating replies
  forever.
- **Backlog protection** — the first run (or a Gmail `UIDVALIDITY` change)
  only baselines the watermark to the current end of the mailbox and replies
  to nothing.
- **Reply cap** — at most `GMAIL_MAX_REPLIES` (default 5) replies per run.

## Files

| File                | Purpose                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `gmail-agent.mjs`   | The whole application. Plain ESM, no build step.                           |
| `package.json`      | Runtime deps: `imapflow`, `mailparser`, `nodemailer`, `@anthropic-ai/sdk`. |
| `package-lock.json` | Committed so the in-sandbox `npm ci` is reproducible.                      |
| `manifest.json`     | The `ApplicationManifest` that makes the platform run it.                  |

The manifest's `command` copies the app out of the workspace, installs deps
in `/tmp` (so `node_modules` never syncs to S3), and runs the script:

```
bash -c "cp -R /workspace/gmail-agent /tmp/app && cd /tmp/app \
  && npm ci --omit=dev --no-audit --no-fund && node gmail-agent.mjs"
```

`manifest.image` is currently informational — `RunTask` cannot override the
container image, so the static base image (Node 22 + AWS CLI) runs the
command against the synced workspace. That is exactly what this app relies
on. `registry.npmjs.org` is in `egressAllow` only for the `npm ci`; vendor
`node_modules` into the workspace and drop both the `npm ci` and the registry
domain if you prefer a tighter allowlist.

## Setup

### 1. Gmail: 2FA + app password

This app signs in with a Google **app password** — a 16-character password
that works over IMAP/SMTP without OAuth (avoiding the OAuth testing-mode
7-day refresh-token trap). Use a dedicated Gmail account for the agent.

1. Sign in to the agent's Google account.
2. Enable 2-Step Verification: <https://myaccount.google.com/security> →
   _2-Step Verification_. App passwords are only offered once 2FA is on.
3. Create an app password: <https://myaccount.google.com/apppasswords> →
   name it (e.g. `agent-village`) → copy the 16-character password (spaces
   don't matter).
4. IMAP access is enabled by default on new accounts; if the account is old,
   check Gmail → _Settings_ → _Forwarding and POP/IMAP_ → _IMAP access_.

### 2. Create the agent

Create an agent as usual (web UI or `POST /agents`). Relevant fields:

- `spendLimitUsd` — the hard LLM+compute budget, e.g. `5`. The metering
  gateway starts rejecting calls mid-run when it's exhausted.
- `schedule` — e.g. `rate(15 minutes)` or `cron(0/15 * * * ? *)`. The
  **agent-level** schedule drives runs; `manifest.schedule` is informational.

### 3. Store the secrets

Secret grants resolve `agent-village/<env>/agents/<agentId>/<name>`. Store
three secrets (the app's config rides the same mechanism — the manifest has
no plain-env field):

```sh
ENV=dev            # your deployment env
AGENT_ID=agt_...   # from step 2
PREFIX="agent-village/$ENV/agents/$AGENT_ID"

aws secretsmanager create-secret --name "$PREFIX/gmail-app-password" \
  --secret-string 'abcdabcdabcdabcd'
aws secretsmanager create-secret --name "$PREFIX/gmail-address" \
  --secret-string 'my-agent@gmail.com'
aws secretsmanager create-secret --name "$PREFIX/gmail-allowed-senders" \
  --secret-string 'me@example.com,teammate@example.com'
```

### 4. Seed the workspace

The workspace is the S3 prefix `<ownerSub>/<agentId>/` in the SandboxStack
workspace bucket (stack output `WorkspaceBucketName`; `ownerSub` is your
Cognito user sub, shown by `GET /me`). Upload the app into a `gmail-agent/`
subdirectory:

```sh
BUCKET=$(aws cloudformation describe-stacks --stack-name "AgentVillage-$ENV-Sandbox" \
  --query "Stacks[0].Outputs[?OutputKey=='WorkspaceBucketName'].OutputValue" --output text)

aws s3 cp examples/gmail-agent/gmail-agent.mjs   "s3://$BUCKET/$OWNER_SUB/$AGENT_ID/gmail-agent/"
aws s3 cp examples/gmail-agent/package.json      "s3://$BUCKET/$OWNER_SUB/$AGENT_ID/gmail-agent/"
aws s3 cp examples/gmail-agent/package-lock.json "s3://$BUCKET/$OWNER_SUB/$AGENT_ID/gmail-agent/"
```

### 5. Attach the manifest and run

```sh
village agents manifest "$AGENT_ID" examples/gmail-agent/manifest.json
village run "$AGENT_ID"                     # first run only baselines the watermark
village logs "$AGENT_ID" <runId> --follow   # tail the run
village agents show "$AGENT_ID"             # spend, month-to-date, recent runs
```

Send the agent's address an email from an allow-listed sender, then run
again (or wait for the schedule): the second run fetches it, drafts a reply
through the metered gateway, and sends it.

## Configuration reference

| Env var                 | Source              | Meaning                                                                           |
| ----------------------- | ------------------- | --------------------------------------------------------------------------------- |
| `GMAIL_ADDRESS`         | secret grant        | The agent's Gmail address (IMAP/SMTP login).                                      |
| `GMAIL_APP_PASSWORD`    | secret grant        | The 16-char app password.                                                         |
| `GMAIL_ALLOWED_SENDERS` | secret grant        | Comma-separated addresses that may get replies.                                   |
| `GMAIL_AGENT_MODEL`     | optional            | Model id; default `claude-opus-4-8`. Must be a model the metering gateway prices. |
| `GMAIL_MAX_REPLIES`     | optional            | Reply cap per run; default 5.                                                     |
| `AV_WORKSPACE_DIR`      | platform / optional | Workspace dir; defaults to `/workspace`.                                          |

State lives at `<workspace>/gmail-agent/state.json`
(`{ "uidValidity": n, "lastUid": n }`).

## Known limitations

- **Implicit TLS only** — the egress proxy cannot carry STARTTLS
  (SMTP 587 / IMAP 143); Gmail's 465/993 implicit-TLS ports are used instead.
- **Model set** — the metering gateway only prices the platform's supported
  model ids (`claude-fable-5`, `claude-opus-4-8`, `claude-opus-4-7`,
  `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-haiku-4-5`,
  `claude-haiku-4-5-20251001`); other ids are rejected with a 400.
- **Non-secret config rides secret grants** — the manifest has no plain env
  mechanism, so `gmail-address` / `gmail-allowed-senders` are stored as
  (non-sensitive) secrets.
- **Per-run `npm ci`** — deps are re-downloaded each run (~a few seconds,
  lockfile-pinned). Vendoring `node_modules` into the workspace avoids the
  download at the cost of syncing thousands of files.
