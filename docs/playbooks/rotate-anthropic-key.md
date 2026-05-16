# Playbook: rotate an agent's Anthropic API key

Each agent's API key is a separate secret in AWS Secrets Manager,
referenced by ARN on the agent's DDB record.

## Through the UI (preferred, Phase 1)

1. Sign in to the deployed UI.
2. Open the agent's detail page.
3. Click "Rotate key" → paste the new key → save.
4. The next scheduled or manual run uses the new key.

The UI calls the API which:

1. Writes the new value to the same Secrets Manager secret (`PutSecretValue`).
2. The secret stays at the same ARN, so the agent record needs no update.
3. Returns the new secret version id.

## Through the AWS Console (emergency)

1. Open Secrets Manager → find
   `agent-village/<env>/agents/<agentId>/anthropic-key`.
2. Set a new secret value.
3. The runner Lambda will use it on the next invocation (no caching across
   invocations).

## After rotation

- The next Run should succeed normally.
- Failed runs caused by the old key will show as `status=error` with an
  Anthropic 401; no replay is needed — the next scheduled run will work.
