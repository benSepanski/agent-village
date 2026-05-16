# Playbook: add a frontend route

The SPA uses TanStack Router. Routes live under `packages/web/src/routes/`.

## 1. Define the route file

```ts
// packages/web/src/routes/agents.$agentId.tsx
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/agents/$agentId')({
  component: AgentDetail,
  loader: async ({ params }) => fetchAgent(params.agentId),
});

function AgentDetail() {
  const agent = Route.useLoaderData();
  // ...
}
```

## 2. Add a Zod schema for any input

Inputs that come from outside the SPA (URL params, form state, API
responses) must be parsed through a Zod schema in
`@agent-village/shared/schemas`. The SPA and the API share these schemas.

## 3. Add component tests

Vitest + `@testing-library/react`. Component tests live next to the
component file as `<name>.test.tsx`.

## 4. Add an E2E test

Playwright spec under `packages/web/e2e/`. The CI deploy job runs these
against the deployed `dev` URL after every successful deploy.

## 5. Verify locally

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm dev               # SPA at http://127.0.0.1:5173
pnpm e2e               # local Playwright run
```
