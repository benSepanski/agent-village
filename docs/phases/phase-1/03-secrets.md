# Phase 1, Step 3 — Secrets adapter

Store, fetch, and rotate Anthropic API keys in AWS Secrets Manager. The plaintext key never lives in DynamoDB.

## Files to create

```
packages/data/src/secrets/
├── client.ts           # SecretsManagerClient factory (LocalStack-aware)
├── anthropic.ts        # storeAnthropicKey, getAnthropicKey, rotateAnthropicKey
└── index.ts
```

## Naming convention

Each agent's key lives at:

```
agent-village/<env>/agents/<agentId>/anthropic-key
```

This is stable across rotations — `PutSecretValue` updates the value in place, so the ARN stored on the Agent record never changes.

## API

```ts
storeAnthropicKey(agentId: string, plaintextKey: string, env: string): Promise<{ arn: string }>
getAnthropicKey(arn: string): Promise<string>
rotateAnthropicKey(arn: string, plaintextKey: string): Promise<void>
deleteAnthropicKey(arn: string): Promise<void>   // called from agent deletion
```

## Tests

Use [`packages/data/test-utils/secrets-mock.ts`](../../../packages/data/test-utils/secrets-mock.ts).

## Acceptance

- Calling `storeAnthropicKey` then `getAnthropicKey` round-trips the value.
- `pnpm --filter @agent-village/data test` green.

## Reference

- [rotate-anthropic-key playbook](../../playbooks/rotate-anthropic-key.md)
