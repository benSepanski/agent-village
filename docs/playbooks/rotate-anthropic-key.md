# Playbook: rotate an agent's Anthropic API key

Each agent's key is its own Secrets Manager secret at `agent-village/<env>/agents/<agentId>/anthropic-key` ([`secretName()` in `secrets/anthropic.ts`](../../packages/data/src/secrets/anthropic.ts)). The agent's DynamoDB record stores only the ARN; the runner fetches the value fresh on every run, so a rotation takes effect on the next run with no cache to invalidate.

## Through the UI

1. Open the agent's detail page and scroll to the **Edit** form.
2. Enter the new key in the "Anthropic API key" field (left blank, the field means "keep the current key" — see `toPatch()` in [`agents.$agentId.tsx`](../../packages/web/src/routes/agents.$agentId.tsx)).
3. Save. The form sends `PATCH /agents/:id` with `anthropicApiKey`; the handler calls [`updateAgent()` in `services/agent.ts`](../../packages/services/src/agent.ts), which writes the new value to the **same secret** via `PutSecretValue` ([`rotateAnthropicKey()`](../../packages/data/src/secrets/anthropic.ts)). The ARN is unchanged, so the agent record needs no key update.

There is no dedicated rotation endpoint — rotation is a partial agent update.

## Through the API or CLI

```bash
curl -X PATCH "$API/agents/<agentId>" \
  -H "Authorization: Bearer $ID_TOKEN" \
  -d '{"anthropicApiKey": "sk-ant-..."}'
```

(The `village` CLI has no key-rotation command; use the UI or the API directly.)

## Through the AWS Console (emergency)

1. Secrets Manager → `agent-village/<env>/agents/<agentId>/anthropic-key`.
2. **Retrieve secret value → Edit** → paste the new key → save.
3. The next run picks it up — the runner calls `GetSecretValue` per invocation with no caching ([`executeReserved()` in `runner.ts`](../../packages/services/src/runner.ts)).

## After rotation

- The next scheduled run, or a "Run now" from the agent page, should complete with `status=ok`.
- Runs that failed on the revoked key show `status=error` with the Anthropic authentication error in the `error` field. No cleanup is needed; run records are append-only.
