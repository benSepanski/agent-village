# ADR 0004: Metered Anthropic access for sandbox runs via a platform gateway

Date: 2026-07-03
Status: Accepted

## Context

Phase 3 makes one-off sandbox applications first-class, and most of them will
call Anthropic. The platform's core cost guarantee — `spendUsedUsd` never
exceeds `spendLimitUsd`, enforced by the reserve→reconcile ledger
([spend-reservation](../data-model/spend-reservation.md)) — currently covers
only the inline (Phase 1) path, where the platform itself makes the API call.
A sandbox app makes its own calls, so something must meter them.

The obvious enforcement point does not work: the egress proxy sidecar
([ADR 0003](0003-egress-proxy-sidecar.md)) is an SNI **peek-and-splice**, not a
MITM. It sees only the TLS ClientHello hostname and then splices bytes — it
**cannot** see request bodies, response `usage` fields, or even distinguish one
API call from another inside the encrypted stream. Hostname allowlisting can
decide _whether_ the app may reach `api.anthropic.com`, never _how much_ it
spends there.

Two shapes were considered:

1. **Raw key injection + provider-side cap.** Inject the agent's Anthropic key
   as a grant env var and rely on Anthropic workspace/organization spend caps.
   Simple, streaming-native — but the spend limit moves _outside_ the platform:
   no per-run attribution, no mid-run hard stop tied to `spendLimitUsd`, no
   single ledger across inline and sandbox runs, and a key that lives in the
   sandbox can be exfiltrated by a steered agent and used from anywhere,
   forever, until rotated.
2. **Platform-held key behind a metering gateway.** The sandbox never receives
   a real key; `ANTHROPIC_BASE_URL` points at a platform endpoint that meters
   each call against the existing ledger before forwarding. The Anthropic SDK
   honors `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`, so apps need zero code
   changes.

## Decision

Build the **metering gateway** (option 2): a dedicated Lambda
(`{prefix}-anthropic-gateway`, [`packages/runner/src/gateway.ts`](../../packages/runner/src/gateway.ts))
exposed through a **Lambda function URL**, fronting `api.anthropic.com`.

- **Per-run bearer token, hash-at-rest.** At launch the runner mints
  `avgw1.<agentId>.<runId>.<32-random-bytes-hex>` and stores only the SHA-256
  hash of the secret part on the Run record (`gatewayTokenHash`). The sandbox
  gets `ANTHROPIC_BASE_URL=<function URL>` and `ANTHROPIC_API_KEY=<token>`.
  The gateway parses the token, loads the run, compares hashes in constant
  time, and rejects tokens whose run is no longer active — so a leaked token
  dies with its run and is scoped to one agent's budget even while alive. No
  shared signing secret, no KMS dependency.
- **The real key stays platform-side.** The gateway forwards with the agent's
  configured Anthropic key, fetched from Secrets Manager by the ARN on the
  Agent record and cached in-memory per ARN. The key never enters the task.
- **Reserve → forward → reconcile, on the existing ledger.** Per call, the
  gateway estimates worst case (the request's `max_tokens` output plus input
  approximated from request-body size) using the pricing table in
  [`packages/domain/src/cost.ts`](../../packages/domain/src/cost.ts), reserves
  via the same conditional `reserveSpend` the inline path uses, forwards, then
  reconciles the delta from the response's `usage` via `finalizeSpend`.
  Upstream failures refund the full estimate. Real usage is also accumulated
  onto the Run record (`costUsd`/`tokensIn`/`tokensOut`, atomic `ADD`), so a
  sandbox run's cost is actual LLM spend, not just the Fargate flat estimate.
- **Hard stop when exhausted.** When `reserveSpend` hits the limit, the
  gateway returns **402** with an Anthropic-shaped `billing_error` body and
  patches the run to `spend_limit_exceeded`; the lifecycle handler preserves
  that status when the task later stops. The app keeps its compute (already
  reserved and time-boxed by the step-01 kill switch) but can spend nothing
  more on tokens.
- **Reachability.** The launcher automatically unions the gateway's hostname
  into the run's egress allowlist, so metered LLM access works even with an
  empty `manifest.egressAllow`.
- **Buffered forwarding.** The gateway buffers the upstream response (and
  parses `usage` out of either a JSON body or a completed SSE stream) before
  returning it. Function-URL response streaming is deliberately deferred.

## Consequences

- The spend cap becomes a **platform** guarantee for sandbox runs — same
  ledger, same invariant, one place to audit — and per-call spend is
  attributable to a specific run.
- A compromised sandbox can leak only its per-run token: useless after the
  run ends, and capped by the agent's own budget while it lives.
- **Streaming is degraded, not absent**: `stream: true` works but the client
  receives all SSE events at once when generation finishes. Latency-sensitive
  streaming apps must wait for response-streaming support.
- Only `POST /v1/messages` is metered and forwarded; other Anthropic endpoints
  (batches, token counting, files) are rejected until they get a metering
  story.
- Models must exist in the platform pricing table — an unpriced model is
  rejected with 400 rather than passed through unmetered.
- Each LLM call costs 2–3 extra DynamoDB writes and one Lambda invocation of
  latency; acceptable at personal scale.
- The pre-call input estimate is approximate (chars/4); the window between
  reserve and reconcile is a single call, so worst-case transient
  over/under-reservation is one call's error, corrected immediately after.

## Status

Accepted.
