# Phase 4+ roadmap

Sketches only. Each phase will get its own detailed breakdown when it's next.
Phase 2 (sandboxed application runs) is detailed in
[phase-2-sandbox-runs](phase-2-sandbox-runs.md); its tool-grant model
(`ApplicationManifest.grants`) absorbs what were previously the outbound-email,
read-only-MCP, and GitHub phases — those now ship as grant kinds + the egress
proxy rather than standalone phases. Phase 3 (platform capabilities so one-off
manifest applications are self-serve, with a Gmail-agent reference app) is
detailed in [phase-3-application-platform](phase-3-application-platform.md) and
absorbs the sandbox-hardening items (kill switch, metered LLM spend, proxy port
preservation, generic secret grants, honest cost/observability).

| Phase | Theme             | Headline deliverable                                                                                                                                           |
| ----- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4     | Notifications     | Per-user notification routing (email + future Slack); pause-on-failure policy                                                                                  |
| 5     | Built-in tools    | Anthropic `web_search`, `code_execution` for inline (non-sandbox) agents                                                                                       |
| 6     | More grant kinds  | Gmail / Calendar read-only via per-agent OAuth, as `ApplicationManifest` grants                                                                                |
| 7     | Multi-user        | Admin / viewer roles per agent; org-scoped Cognito groups                                                                                                      |
| 8     | Retention + audit | Retention policies + an audit-summarizer agent over old runs                                                                                                   |
| 9+    | Daemon apps       | Hosting always-on agent daemons (e.g. OpenClaw): service-mode runtime instead of scheduled tasks, per-manifest task definitions so `manifest.image` is honored |

Each phase reuses the harness from Phase 0. No new top-level concerns unless an [ADR](../adr/README.md) justifies it.
