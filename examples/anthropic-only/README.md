# anthropic-only — connectivity recipe (AC-6.1)

The simplest connectivity pattern: an agent that reaches **only** the
metering gateway (i.e. the Anthropic API) — no external services, no
third-party APIs, no side channels. Good baseline for pure
reasoning/generation tasks that don't need external data.

This directory is a **manifest recipe**, not a full runnable app — it
demonstrates the `egressAllow` shape for this pattern. For a complete,
runnable app skeleton, run `village init` or copy the structure of
[`examples/gmail-agent`](../gmail-agent/) and drop this manifest's
`egressAllow`/`grants` block in.

## The manifest

```json
{
  "egressAllow": [],
  "grants": []
}
```

`egressAllow: []` — completely empty. The proxy still lets the run reach:

- AWS base domains for the deploy region (S3 workspace bucket, STS, Logs —
  `packages/services/src/sandbox-egress.ts` `awsBaseDomains`).
- The metering gateway host, injected automatically by the sandbox launcher
  as an `extraHosts` entry (`gatewayHost(config.gatewayUrl)` in
  `packages/services/src/sandbox.ts`) — every manifest gets this regardless
  of `egressAllow`, so a normal Anthropic SDK call (which honors
  `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`) always works.

No `grants` — the agent needs no external credentials.

## Connectivity verification

- **Allow-path (derivation)**: `packages/services/src/sandbox-egress.test.ts`
  asserts `buildEgressAllowlist(manifest, region, bucket, [gatewayHost])`
  includes the gateway host and the AWS base domains.
- **Allow-path (enforcement)**: `packages/infra/test/proxy-allowlist.test.ts`
  asserts `isHostAllowed(gatewayHost, list)` is `true`.
- **Deny-path**: both the derivation and enforcement tests assert an
  off-list host (`evil.example.com`) is absent from the derived list / not
  allowed by the matcher.

See [`docs/recipes/anthropic-only.md`](../../docs/recipes/anthropic-only.md)
for the full writeup.
