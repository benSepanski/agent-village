'use strict';

/**
 * Mechanically enforced package dependency graph.
 *
 * Allowed edges (every other cross-package import fails the build):
 *   shared   ← domain ← data ← services ← {api, runner, cli}
 *   shared   ← web
 *   shared   ← infra
 *
 * Anything outside this graph is a violation; the error message lists the
 * permitted edges so the agent can self-correct.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular dependencies indicate the layer boundaries are wrong. Refactor to remove the cycle.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Orphan modules are unused. Either delete or wire them up.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '\\.d\\.ts$',
          '(^|/)tsconfig\\.json$',
          '(^|/)(babel|nodemon|vite|vitest|playwright|tsup)\\.config\\.(js|cjs|mjs|ts)$',
        ],
      },
      to: {},
    },
    {
      name: 'shared-is-leaf',
      severity: 'error',
      comment:
        '`shared` is the leaf of the dependency graph. It must not depend on any other workspace package. Move the cross-cutting code into `shared` itself if it is truly shared, or up into the consumer package.',
      from: { path: '^packages/shared/' },
      to: { path: '^packages/(?!shared/)[^/]+/' },
    },
    {
      name: 'domain-only-depends-on-shared',
      severity: 'error',
      comment:
        '`domain` must contain pure business logic only and may only import from `shared`. If you need I/O, lift the orchestration into `services` and inject pure helpers from `domain`.',
      from: { path: '^packages/domain/' },
      to: { path: '^packages/(?!(shared|domain)/)[^/]+/' },
    },
    {
      name: 'data-may-depend-on-shared-and-domain',
      severity: 'error',
      comment:
        '`data` may only import from `shared` and `domain`. Cross-talk to `services`, `api`, or `runner` violates the layer direction.',
      from: { path: '^packages/data/' },
      to: { path: '^packages/(?!(shared|domain|data)/)[^/]+/' },
    },
    {
      name: 'services-may-depend-on-lower-layers',
      severity: 'error',
      comment:
        '`services` may only import from `shared`, `domain`, and `data`. Importing from `api`, `runner`, `web`, `cli`, or `infra` is a layer-direction violation.',
      from: { path: '^packages/services/' },
      to: { path: '^packages/(?!(shared|domain|data|services)/)[^/]+/' },
    },
    {
      name: 'api-only-depends-on-shared-and-services',
      severity: 'error',
      comment:
        '`api` may only import from `shared` and `services`. Direct imports from `data` or `domain` skip the service layer.',
      from: { path: '^packages/api/' },
      to: { path: '^packages/(?!(shared|services|api)/)[^/]+/' },
    },
    {
      name: 'runner-only-depends-on-shared-and-services',
      severity: 'error',
      comment:
        '`runner` may only import from `shared` and `services`. Direct imports from `data` or `domain` skip the service layer.',
      from: { path: '^packages/runner/' },
      to: { path: '^packages/(?!(shared|services|runner)/)[^/]+/' },
    },
    {
      name: 'cli-only-depends-on-shared-and-services',
      severity: 'error',
      comment:
        '`cli` may only import from `shared` and `services`. Direct imports from `data` or `domain` skip the service layer.',
      from: { path: '^packages/cli/' },
      to: { path: '^packages/(?!(shared|services|cli)/)[^/]+/' },
    },
    {
      name: 'web-only-depends-on-shared',
      severity: 'error',
      comment:
        '`web` is a browser bundle and must only import from `shared`. Server packages (`data`, `services`, `api`) cannot run in the browser; expose the data through HTTP from `api` instead.',
      from: { path: '^packages/web/' },
      to: { path: '^packages/(?!(shared|web)/)[^/]+/' },
    },
    {
      name: 'infra-only-depends-on-shared',
      severity: 'error',
      comment:
        '`infra` is CDK code and must only import from `shared` (for constants/schemas). Application code lives in app packages, not in the IaC.',
      from: { path: '^packages/infra/' },
      to: { path: '^packages/(?!(shared|infra)/)[^/]+/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: '(^|/)(dist|cdk\\.out|coverage|\\.turbo|playwright-report|node_modules)(/|$)',
    },
    includeOnly: '^(packages|tools)/',
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
