# Phase 5 — external application developer experience

Goal: make agent-village **consumable from separate application repos**. After
this phase, "build an app" means: create a repo, scaffold it with
`village init`, and drive the whole lifecycle (sign in → create agent → store
secrets → push workspace → attach manifest → run → tail logs) with the CLI
alone — **no AWS credentials, no monorepo checkout, no web-UI detours**. This
is what the driving apps need (apply-bot, a D&D campaign assistant, a
recipes/shopping-list bot): each is its own GitHub repo whose only
agent-village dependency is the installed CLI and the platform contract.

Today three gaps block that:

1. **Workspace seeding needs raw AWS credentials.** The gmail-agent README
   uploads with `aws s3 cp` after a CloudFormation `describe-stacks` — a
   platform-operator move, impossible for a friend with only a Cognito login.
2. **The CLI cannot sign in or manage agents.** There is no `village login`
   (users hand-craft a credentials JSON) and no
   `village agents create/update/rm` (the routes exist; the commands don't).
3. **The CLI only exists inside the monorepo** (`private: true`, TS-source
   `main`, workspace deps) — an app repo cannot install it.

| Step | Deliverable                                                                                                                               | Status |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 01   | Workspace API: `GET /agents/{id}/workspace` (list) + `POST /agents/{id}/workspace/presign` (batch presigned GET/PUT/DELETE), owner-scoped | ✅     |
| 02   | CLI workspace commands: `village workspace ls / push / pull / rm`                                                                         | ✅     |
| 03   | `village login` / `logout` + persisted CLI config; a Cognito CLI app client (`USER_PASSWORD_AUTH`)                                        | ✅     |
| 04   | CLI agent lifecycle: `village agents create / update / rm`                                                                                | ✅     |
| 05   | Installable CLI: bundled single-file build + `pnpm cli:pack` tarball an app repo can `npm i -g`                                           | ✅     |
| 06   | `village init` — scaffold a new app repo (manifest, app script, README, lockfile-ready package.json)                                      | ✅     |
| 07   | `docs/app-development.md` — the external app-builder guide + capability mapping for the driving apps; doc index/README/roadmap updates    | ✅     |

## Step notes

- **01 — workspace API.** The workspace is the S3 prefix
  `<ownerSub>/<agentId>/` in the SandboxStack workspace bucket (the same
  prefix the runner syncs into `/workspace`). Shared schemas
  (`packages/shared/src/schemas/workspace.ts`): `WorkspacePath` — a relative
  path, split on `/`, every segment must match `[A-Za-z0-9._-]+` and must not
  be `.` or `..`, ≤ 512 chars total (keys stay printable and traversal is
  unrepresentable); `ListWorkspaceResponse` (`entries: {path, size,
lastModified}[]`, `truncated: boolean`); `PresignWorkspaceInput`
  (`files: {path, op: 'get'|'put'|'delete'}[]`, 1–100 entries);
  `PresignWorkspaceResponse` (`urls: {path, op, url, expiresAt}[]`). Service
  (`packages/services/src/workspace.ts`): every operation first loads the
  agent via `agentRepo.getAgent(ownerSub, agentId)` (same ownership rule as
  agent-secrets), then derives keys only as `${ownerSub}/${agentId}/${path}`.
  Data layer (`packages/data/src/s3/workspace.ts`): `ListObjectsV2` (one page,
  MaxKeys 1000, report `truncated`) and `getSignedUrl` PUT/GET/DELETE with a
  15-minute expiry. Infra: `ApiStack` gains a `workspaceBucket` prop
  (`bin/app.ts` passes `sandbox.workspaceBucket`); the two handlers get
  `AV_WORKSPACE_BUCKET` and a per-handler extras grant (the
  `grantRunNowExtras` pattern) — list: `s3:ListBucket` on the bucket; presign:
  object get/put/delete on `arn:.../*` (presigned URLs are key-scoped; the
  wildcard is the signing role's grant, documented like the other IAM5
  suppressions if nag flags it). Concurrency note for docs: a push racing a
  run's final sync-back can be overwritten — push between runs.

- **02 — CLI workspace commands.** `village workspace ls <agentId>`
  (table: path, size, mtime), `push <agentId> <localPath> [--dest <sub/dir>]`
  (walk files — skip `.git`, `node_modules`, symlinks; presign in batches of
  100; HTTP PUT each; print a per-file line and a total),
  `pull <agentId> [destDir] [--prefix <sub/dir>]` (list → presign GET →
  download), `rm <agentId> <path>` (presign DELETE → HTTP DELETE). Tests use
  the existing `fakeClient` pattern plus a stubbed global `fetch` for the
  presigned transfers.

- **03 — login + config.** AuthStack gains a second app client
  (`CliClient`: `authFlows: { userPassword: true }`, no OAuth, same token
  validities, `preventUserExistenceErrors`) with its id in a `CfnOutput`.
  The CLI persists non-secret config at
  `~/.config/agent-village/config.json` — `{apiUrl, region, clientId}` —
  written by `village login --api-url … --region … --client-id …` (flags are
  remembered; later logins can omit them; `AV_API_URL` still overrides).
  `village login` prompts for email + password (hidden input, direct TLS to
  `cognito-idp.<region>.amazonaws.com` `InitiateAuth` / `USER_PASSWORD_AUTH`
  via fetch — no SDK dependency), answers a `SOFTWARE_TOKEN_MFA` challenge by
  prompting for the code, and stores the refresh token exactly where
  `auth.ts` already looks (keychain, plaintext-file fallback with the
  existing warning). `StoredCredentials` becomes a discriminated union — the
  legacy hosted-UI-domain shape keeps refreshing via `oauth2/token`; the new
  `{region, clientId, refreshToken}` shape refreshes via
  `REFRESH_TOKEN_AUTH`. `village logout` deletes both stores. Password never
  touches disk or argv; it is read from the TTY and sent only to Cognito.

- **04 — agent lifecycle commands.** `village agents create --file
<agent.json>` (or `-` for stdin) parses through `CreateAgentInput` locally
  (fail fast, better errors than a 400), POSTs, prints the new id + name;
  `update <agentId> --file …` uses `UpdateAgentInput` + PATCH; `rm <agentId>
[--yes]` DELETEs after a TTY confirm. No flag-per-field surface — JSON in
  a file is the format app repos already keep manifests in.

- **05 — installable CLI.** `pnpm --filter @agent-village/cli bundle` runs
  esbuild over `bin/village.js` → a single ESM file with a `#!/usr/bin/env
node` banner; workspace deps are bundled in, `@napi-rs/keyring` stays
  external (native module, already an optional runtime `import()` in
  `auth.ts`). `pnpm cli:pack` (root script) assembles `packages/cli/dist/pkg/`
  — the bundle plus a minimal generated `package.json` (`name
"@agent-village/cli"`, `bin.village`, `optionalDependencies:
{"@napi-rs/keyring"}`) — and `npm pack`s it to a tarball. An app repo (or a
  friend) installs with `npm i -g <tarball>`; no monorepo required.

- **06 — `village init`.** `village init <dir>` (refuses a non-empty dir)
  scaffolds the gmail-agent shape in miniature: `manifest.json` (name from
  the dir, `image: "sandbox-base"`, the copy-to-`/tmp` + `npm ci` command,
  `timeoutMinutes: 10`, empty `egressAllow`/`env`), `app.mjs` (reads state
  from `AV_WORKSPACE_DIR`, one metered Anthropic call via the injected
  `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`, writes state back), a
  `package.json` with `@anthropic-ai/sdk`, a `.gitignore`, and a README
  listing the exact lifecycle commands (login → create → secrets → push →
  manifest → run → logs).

- **07 — app-builder guide.** `docs/app-development.md` — the one-stop
  external view: the app contract (what the platform injects: workspace dir,
  metered Anthropic env, `manifest.env`, secret grants; what it enforces:
  egress allowlist, spend cap, timeout, one-run-per-agent), the full CLI
  lifecycle, custom images for non-Node runtimes
  ([`examples/python-sandbox-image`](../../examples/python-sandbox-image/)),
  and an honest capability mapping for the driving apps — apply-bot (ready:
  Python image + env + secrets + session file in workspace), D&D assistant
  (ready: state in workspace; interaction model is push-input-then-run, no
  mid-run input), recipes/shopping bot (ready: schedule + egress to calendar
  ICS/API), OpenClaw-style daemon (**not yet**: needs the phase-6+ daemon
  runtime; frequent scheduled runs are the interim). Linked from
  `docs/README.md`, `AGENTS.md`, and the top-level README; roadmap updated.

After each step: `pnpm lint && pnpm typecheck && pnpm test` stays green, and
`pnpm --filter @agent-village/infra synth:dev` must succeed without AWS
credentials.
