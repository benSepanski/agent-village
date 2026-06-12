# Playbook: add a frontend route

The SPA uses TanStack Router with **code-based route registration** — all routes are declared centrally in [`packages/web/src/router.tsx`](../../packages/web/src/router.tsx). There is no file-based route discovery; a new file under `routes/` does nothing until it is registered.

## 1. Write the page component

Page components live in `packages/web/src/routes/` (file name mirrors the path, e.g. `agents.$agentId.tsx` for `/agents/$agentId`). Data fetching is `useQuery` from TanStack Query against the shared API client — there are no route loaders. Copy an existing page, e.g. [`agents.$agentId.tsx`](../../packages/web/src/routes/agents.$agentId.tsx):

```tsx
import { useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api-client/client.js';
import type { Agent } from '../api-client/types.js';

export function AgentDetailPage() {
  const { agentId } = useParams({ from: '/agents/$agentId' });
  const { data: agent } = useQuery<Agent>({
    queryKey: ['agents', agentId],
    queryFn: () => api.get(`/agents/${agentId}`),
  });
  // ...
}
```

## 2. Register the route in `router.tsx`

```tsx
const agentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents/$agentId',
  component: AgentDetailPage,
});
```

…and add it to the `routeTree` via `rootRoute.addChildren([...])`. The root layout ([`routes/__root.tsx`](../../packages/web/src/routes/__root.tsx)) wraps everything in the auth provider, so new routes are sign-in-protected by default.

## 3. Types and schemas

Request/response shapes come from `@agent-village/shared` (the same Zod schemas the API parses with), surfaced to components through [`api-client/types.ts`](../../packages/web/src/api-client/types.ts). If the route needs a new shape, add the schema in [`packages/shared/src/schemas/`](../../packages/shared/src/schemas/), export it from the package index, and re-export the type in `api-client/types.ts`.

## 4. Tests

- **Component tests** — Vitest + `@testing-library/react`, colocated as `<name>.test.tsx`. Mock the API client and wrap with the providers the component needs; copy the setup in [`AgentForm.test.tsx`](../../packages/web/src/components/AgentForm.test.tsx).
- **E2E** — Playwright specs in [`packages/web/e2e/`](../../packages/web/e2e/). Locally they run against the Vite dev server; in the deploy workflow they run against the deployed URL (`AV_E2E_BASE_URL`, see [`playwright.config.ts`](../../playwright.config.ts)).

## 5. Verify

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm dev               # SPA at http://127.0.0.1:5173
pnpm e2e               # boots the dev server automatically
```
