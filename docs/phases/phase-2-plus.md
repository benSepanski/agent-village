# Phase 3+ roadmap

Sketches only. Each phase will get its own detailed breakdown when it's next.
Phase 2 (sandboxed application runs) is detailed in
[phase-2-sandbox-runs](phase-2-sandbox-runs.md); its tool-grant model
(`ApplicationManifest.grants`) absorbs what were previously the outbound-email,
read-only-MCP, and GitHub phases — those now ship as grant kinds + the egress
proxy rather than standalone phases.

| Phase | Theme             | Headline deliverable                                                            |
| ----- | ----------------- | ------------------------------------------------------------------------------- |
| 3     | Notifications     | Per-user notification routing (email + future Slack); pause-on-failure policy   |
| 4     | Built-in tools    | Anthropic `web_search`, `code_execution` for inline (non-sandbox) agents        |
| 5     | More grant kinds  | Gmail / Calendar read-only via per-agent OAuth, as `ApplicationManifest` grants |
| 6     | Multi-user        | Admin / viewer roles per agent; org-scoped Cognito groups                       |
| 7     | Retention + audit | Retention policies + an audit-summarizer agent over old runs                    |

Each phase reuses the harness from Phase 0. No new top-level concerns unless an [ADR](../adr/README.md) justifies it.
