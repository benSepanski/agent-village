# Recipe: Anthropic-only agent

An agent that communicates only with Anthropic's API (through the metering
gateway) — no external APIs, third-party services, or side channels. This is
the simplest connectivity pattern and a good baseline.

## What the agent can do

- Call any Anthropic model via the standard SDK.
- Metrics and spend are metered through the gateway.
- All computation happens locally in the Fargate sandbox.

## What the agent cannot do

- Reach any external API or service (GitHub, databases, Slack, etc.).
- Access the internet or pull data from third-party sources.
- Read files or contact services outside the sandbox.

Use case: pure reasoning/generation tasks that don't need external data.

---

## Example structure

Located in `examples/anthropic-only/`:

```
anthropic-only/
├── manifest.json     # egressAllow: [] (empty — only AWS + gateway)
└── README.md         # Recipe writeup
```

This directory is a **manifest recipe**, not a full runnable app — it
demonstrates the `egressAllow`/`grants` shape for this pattern. For a
complete, runnable app skeleton (with `agent.json`, app code, etc.), run
`village init` or copy the structure of
[`examples/gmail-agent`](../../examples/gmail-agent/) and drop this recipe's
`egressAllow`/`grants` block into your own `manifest.json`.

## The manifest

```json
{
  "name": "anthropic-only",
  "image": "sandbox-base",
  "schedule": "rate(1 hour)",
  "timeoutMinutes": 5,
  "egressAllow": [],
  "grants": [],
  "env": {},
  "flushIntervalSeconds": 0
}
```

Key points:

- **`egressAllow: []`** — completely empty. The agent can only reach:
  - AWS endpoints (S3, DynamoDB, Secrets Manager, etc.)
  - The metering gateway (the platform's internal spend-control proxy)
- **No grants** — the agent does not need any external credentials.
- **`image: "sandbox-base"`** — the default Node.js sandbox image.
- If your app code picks the model itself (e.g. a `MODEL` env var), it must
  be one of the platform's priced model ids — `claude-fable-5`,
  `claude-opus-4-8`, `claude-opus-4-7`, `claude-sonnet-5`, `claude-sonnet-4-6`,
  `claude-haiku-4-5`, `claude-haiku-4-5-20251001` (see
  [`examples/gmail-agent`](../../examples/gmail-agent/)'s README) — the
  gateway rejects any other id with a 400.

---

## Connectivity verification

### Allow-path test

**Location**: `packages/services/src/sandbox-egress.test.ts` (derivation test)

Tests that `buildEgressAllowlist(manifest, region, workspaceBucket, [gatewayHost])`
produces a list containing:

- The gateway host (injected by the sandbox)
- AWS base domains for the region (e.g. `us-east-1.amazonaws.com`)

The proxy's `isHostAllowed()` matcher confirms the gateway host is reachable.

### Deny-path test

**Location**: `packages/infra/test/proxy-allowlist.test.ts` (enforcement test)

Tests that an off-list host (e.g. `evil.example.com`) is **not** in the derived
allowlist and `isHostAllowed('evil.example.com', allowlist)` returns `false`,
proving:

- The agent cannot reach arbitrary external services.
- Only the allowlisted hosts (gateway + AWS) are reachable.

---

## Testing locally

Run the allow/deny tests:

```bash
# Derivation test (does the allowlist include the gateway?)
pnpm --filter @agent-village/services test -- sandbox-egress

# Enforcement test (does the proxy enforce the allowlist?)
pnpm --filter @agent-village/infra test -- proxy-allowlist
```

Both must pass for the recipe to be production-ready.

---

## Next steps

- Start with this recipe if you're new to agent-village.
- When you need external APIs, see the [Notion](notion-read-only.md) or
  [email](email-partial.md) recipes for how to add egress allowlist entries
  and grants.
