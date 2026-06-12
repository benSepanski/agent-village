# Key property: agent and user state isolation

**The property:** a user can only read or mutate their own agents and runs, and an agent's credentials and workspace are reachable only through code paths that have already proven ownership.

## Enforcement — data layer (partition keys)

Isolation is built into the key schema, so an unscoped query is structurally impossible rather than merely forbidden:

| Mechanism                                                                                                                                                                                        | Code                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Agents live under `pk=USER#<cognitoSub>`; reading an agent requires the owner's sub in the key. Guessing an `agentId` is useless without it                                                      | [`getAgent()` in `dynamo/agents.ts`](../../packages/data/src/dynamo/agents.ts)                                             |
| Runs live under `pk=AGENT#<agentId>`, and the service layer resolves the agent **owner-scoped first** — `getRun()`/`listForAgent()` call `getMyAgent(ownerSub, agentId)` before touching any run | [`services/runner.ts`](../../packages/services/src/runner.ts), [`services/agent.ts`](../../packages/services/src/agent.ts) |
| The only unscoped lookup (`getAgentById` via the GSI) exists for the trusted scheduler path, which carries no user context; user-initiated runs pass `ownerSub` and are owner-scoped             | [`loadAgent()` in `runner.ts`](../../packages/services/src/runner.ts)                                                      |

## Enforcement — API layer

Every handler derives `ownerSub` from the gateway-verified JWT (`ctx.cognitoSub`, see [user-auth](user-auth.md)) and passes it down; no handler accepts a user ID from the request body or path ([`packages/api/src/handlers/`](../../packages/api/src/handlers/)). A non-owned resource is indistinguishable from a missing one — both return 404.

## Enforcement — credentials

| Mechanism                                                                                                                                                                     | Code                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One secret per agent, namespaced `agent-village/{env}/agents/{agentId}/anthropic-key`; nothing shares secrets across agents                                                   | [`secretName()` in `secrets/anthropic.ts`](../../packages/data/src/secrets/anthropic.ts)                                                                     |
| Lambdas hold IAM grants only on that env's `agents/*` secret path; the runner can only `GetSecretValue`, and only API handlers with `perms: 'write'` can create/rotate/delete | [`runner-stack.ts`](../../packages/infra/src/stacks/runner-stack.ts), [`grantSecretsCrud()` in `api-stack.ts`](../../packages/infra/src/stacks/api-stack.ts) |
| The key reaches the runner only after the agent record (and therefore ownership, on user-initiated paths) has been loaded — the secret ARN comes off the record itself        | [`executeReserved()` in `runner.ts`](../../packages/services/src/runner.ts)                                                                                  |

## Enforcement — sandbox workspaces

| Mechanism                                                                                                                                           | Code                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each (user, agent) owns the S3 prefix `{ownerSub}/{agentId}/`; the entrypoint syncs only the prefix passed at launch via `AV_WORKSPACE_URI`         | [`workspacePrefix()`](../../packages/shared/src/schemas/manifest.ts), [`sandbox-image/entrypoint.sh`](../../packages/infra/sandbox-image/entrypoint.sh) |
| The Fargate task role's bucket-wide grant is the **ceiling**; the launcher design narrows each run to exactly its prefix with an STS session policy | task-role comment in [`sandbox-stack.ts`](../../packages/infra/src/stacks/sandbox-stack.ts), design in [sandbox-runs](../architecture/sandbox-runs.md)  |

## Known limits

- **The sandbox launcher (and its STS narrowing) is not yet implemented** — Phase 2 step 05 in [phase-2-sandbox-runs](../phases/phase-2-sandbox-runs.md). Until it lands, nothing launches sandbox tasks, so the bucket-wide task role is inert but the per-run narrowing is unproven.
- Sandbox egress is unrestricted until the egress proxy (Phase 2 step 07) lands; do not attach credentials to untrusted workloads before then.
- All users share one DynamoDB table and one Lambda fleet — isolation is logical (keys + IAM), not physical. There is no per-tenant encryption key.
