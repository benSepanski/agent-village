import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { RootLayout } from './routes/__root.js';
import { AgentListPage } from './routes/index.js';
import { AgentNewPage } from './routes/agents.new.js';
import { AgentDetailPage } from './routes/agents.$agentId.js';

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: AgentListPage,
});

const agentNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents/new',
  component: AgentNewPage,
});

const agentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents/$agentId',
  component: AgentDetailPage,
});

const routeTree = rootRoute.addChildren([indexRoute, agentNewRoute, agentDetailRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
