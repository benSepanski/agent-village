# Recipe: Read-only Notion agent

An agent that reads data from Notion via its REST API using a scoped,
read-only integration token. The platform blocks the host if not allowlisted
and the token enforces read-only semantics — the combination ensures the
agent can only fetch, never write.

## What the agent can do

- Fetch databases, pages, and blocks from Notion via the REST API.
- Use a scoped integration token (read-only scope set in Notion).
- Call Anthropic to analyze or summarize Notion content.

## What the agent cannot do

- Write, update, or delete Notion pages or databases.
- Reach any host outside the allowlist (the platform blocks it).
- Use the token to authenticate to any other service.

Use case: a weekly summarizer that reads action items from a Notion database
and generates a digest via Claude.

---

## Example structure

Located in `examples/notion-reader/`:

```
notion-reader/
├── manifest.json          # egressAllow: ["api.notion.com"]
└── README.md              # Recipe writeup
```

This directory is a **manifest recipe**, not a full runnable app — it
demonstrates the `egressAllow`/`grants` shape for this pattern. For a
complete, runnable app skeleton, run `village init` or copy the structure of
[`examples/gmail-agent`](../../examples/gmail-agent/) and drop this recipe's
`egressAllow`/`grants` block into your own `manifest.json`.

## The manifest and grants

### manifest.json

```json
{
  "name": "notion-reader",
  "image": "sandbox-base",
  "schedule": "cron(0 9 ? * MON *)",
  "timeoutMinutes": 5,
  "egressAllow": ["api.notion.com"],
  "grants": [{ "kind": "notion", "secretName": "notion-token" }],
  "env": {},
  "flushIntervalSeconds": 0
}
```

Key points:

- **`egressAllow: ["api.notion.com"]`** — only Notion's API is reachable; any
  other host is blocked at the proxy layer.
- **`grants`** — the **typed `notion` grant** (not a generic `secret` grant)
  resolves `agent-village/<env>/agents/<agentId>/notion-token` from Secrets
  Manager and injects it as `NOTION_TOKEN`
  (`packages/services/src/sandbox-grants.ts` `notionEnv`). A generic
  `{"kind":"secret","name":"notion-token","env":"NOTION_API_TOKEN"}` grant
  **cannot** be used here: both the `notion-token` secret leaf and the
  `NOTION_TOKEN` env name are platform-reserved (`RESERVED_SECRET_LEAVES` /
  `isReservedSandboxEnv` in `packages/shared/src/schemas/manifest.ts`)
  precisely so a plain `secret` grant can never shadow this richer,
  purpose-built grant — a manifest with the generic form is rejected.
- **`image: "sandbox-base"`** — the default Node.js sandbox image.

### Secret setup (operator side)

After creating the agent, the operator stores the token:

```bash
village secrets set <agentId> notion-token --value "npl_..."  # Your Notion API key
```

### Getting your Notion API key

1. Go to [notion.com/my-integrations](https://www.notion.com/my-integrations).
2. Create a new internal integration.
3. Set **capabilities** → **Read** content only (no update/create/delete).
4. Generate the **internal integration token**.
5. Give the integration access to the specific database(s) you want to read.

---

## Connectivity verification

### Allow-path test

**Location**: `packages/services/src/sandbox-egress.test.ts` (derivation test)

Tests that `buildEgressAllowlist(manifest, region, workspaceBucket, [gatewayHost])`
produces a list containing:

- `api.notion.com` (from the manifest)
- The gateway host and AWS base domains (always present)

The proxy's `isHostAllowed('api.notion.com', allowlist)` confirms the Notion
API is reachable.

### Deny-path tests

**Location**: `packages/infra/test/proxy-allowlist.test.ts` (enforcement tests)

Tests that:

1. **Off-list host is blocked**: `isHostAllowed('evil.example.com', allowlist)`
   returns `false` — an agent cannot reach unauthorized hosts.

2. **Token enforces read-only**: While the platform blocks the _host_, Notion's
   own permission system enforces read-only semantics. The test documents that
   **the platform is not responsible for enforcement of HTTP verb restrictions**
   — that's the API's scope system. A write attempt to `api.notion.com` will:
   - Reach the allowlisted host (proxy allows it)
   - Be rejected by Notion's API (token has read-only scope)
   - Return a 403 or similar error to the agent

   This split-responsibility model keeps the platform agnostic to HTTP semantics
   while ensuring end-to-end isolation.

---

## Testing locally

Run the allow/deny tests:

```bash
# Derivation test (does the allowlist include api.notion.com?)
pnpm --filter @agent-village/services test -- sandbox-egress

# Enforcement tests (does the proxy allow/deny correctly?)
pnpm --filter @agent-village/infra test -- proxy-allowlist
```

Both must pass for the recipe to be production-ready.

---

## Next steps

- Adapt the example to your Notion database structure.
- Use Claude to analyze or transform the Notion content.
- Schedule it to run weekly or daily via the `schedule` field.

See the [Anthropic-only](anthropic-only.md) recipe for a simpler example with
no external APIs.
