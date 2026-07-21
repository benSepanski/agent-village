# notion-reader — connectivity recipe (AC-6.2)

An agent that reads from the Notion API and nothing else. The platform
enforces which **host** the agent can reach (`api.notion.com`, allowlisted);
it does not — and cannot — enforce which HTTP verbs the agent is permitted to
use against that host. **Read-only is enforced by the Notion integration
token's own scope, not the platform.** Give the token Read-only capabilities
in Notion's integration settings and the write path is closed even though the
proxy would happily carry a POST to the same allowlisted host.

This directory is a **manifest recipe**, not a full runnable app — it
demonstrates the `egressAllow` + grant shape for this pattern. For a
complete, runnable app skeleton, run `village init` or copy the structure of
[`examples/gmail-agent`](../gmail-agent/).

## The manifest

```json
{
  "egressAllow": ["api.notion.com"],
  "grants": [{ "kind": "notion", "secretName": "notion-token" }]
}
```

- `egressAllow: ["api.notion.com"]` — only Notion's API host is reachable
  beyond the always-on AWS base domains + metering gateway; any other host
  (including a typo'd Notion subdomain) is blocked at the proxy layer.
- The **typed `notion` grant** (not the generic `secret` grant) resolves
  `agent-village/<env>/agents/<agentId>/notion-token` from Secrets Manager and
  injects it as `NOTION_TOKEN` (`packages/services/src/sandbox-grants.ts`
  `notionEnv`). A generic `secret` grant can't be used for this: both the
  `notion-token` secret leaf and the `NOTION_TOKEN` env name are reserved
  (`RESERVED_SECRET_LEAVES` / `isReservedSandboxEnv` in
  `packages/shared/src/schemas/manifest.ts`) precisely so a plain `secret`
  grant can never shadow this richer, purpose-built grant.

### Provisioning the token (operator side)

```sh
village secrets set <agentId> notion-token   # paste the integration token
```

Create the integration at <https://www.notion.com/my-integrations>, restrict
its **capabilities** to Read content only, and share only the specific
page(s)/database(s) the agent needs with it.

## Connectivity verification

- **Allow-path (derivation)**: `packages/services/src/sandbox-egress.test.ts`
  asserts `buildEgressAllowlist(manifest, region, bucket, [gatewayHost])`
  includes `api.notion.com`.
- **Allow-path (enforcement)**: `packages/infra/test/proxy-allowlist.test.ts`
  asserts `isHostAllowed('api.notion.com', list)` is `true`.
- **Deny-path**: an off-list host (`evil.example.com`) is absent from the
  derived list and rejected by `isHostAllowed`. The platform blocks
  **hosts and ports**, not HTTP verbs — see the note above.

See
[`docs/recipes/notion-read-only.md`](../../docs/recipes/notion-read-only.md)
for the full writeup.
