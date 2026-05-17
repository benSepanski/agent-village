import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { RootLayout } from './routes/__root.js';
import { AgentListPage } from './routes/index.js';
import { AgentNewPage } from './routes/agents.new.js';
import { AgentDetailPage } from './routes/agents.$agentId.js';
import { RunDetailPage } from './routes/agents.$agentId.runs.$runId.js';
import { HealthPage } from './routes/health.js';

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

const runDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents/$agentId/runs/$runId',
  component: RunDetailPage,
});

const healthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/health',
  component: HealthPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  agentNewRoute,
  agentDetailRoute,
  runDetailRoute,
  healthRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
