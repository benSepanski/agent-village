# Phase 1, Step 11 — Web agent CRUD UI

Agent list, create / edit form, agent detail page (excluding the run viewer — that's Step 12).

## Files to create

```
packages/web/src/
├── routes/
│   ├── __root.tsx              # Layout (top nav, sign-out)
│   ├── index.tsx               # /  → agent list
│   ├── agents.$agentId.tsx     # /agents/$agentId → agent detail (Step 12 fills the run section)
│   └── agents.new.tsx          # /agents/new → create form
├── components/
│   ├── AgentList.tsx
│   ├── AgentForm.tsx           # used by /agents/new and /agents/$agentId (edit mode)
│   ├── StatusBadge.tsx         # active / paused / last-run status
│   └── SpendBar.tsx            # spendUsedUsd / spendLimitUsd visual
```

## Behavior

- The form validates inputs against the same `CreateAgentInput` / `UpdateAgentInput` Zod schemas from `@agent-village/shared` — no client-only validation rules.
- Pause / resume is a `PATCH /agents/:id` with `{ status }`.
- Delete confirms with a dialog showing the secret will be deleted too.
- TanStack Query handles cache invalidation after mutations.

## Acceptance

- `pnpm --filter @agent-village/web test` covers form validation + StatusBadge + SpendBar.
- Manual: create, edit, pause, delete an agent against LocalStack.
- Lighthouse score ≥90 on the agent list page (no images yet, easy).

## Reference

- [add-frontend-route playbook](../../playbooks/add-frontend-route.md)
- [agent entity](../../data-model/agent.md)
