# Phase 2+ roadmap

Sketches only. Each phase will get its own detailed breakdown when it's next.

| Phase | Theme             | Headline deliverable                                                                  |
| ----- | ----------------- | ------------------------------------------------------------------------------------- |
| 2     | Notifications     | Per-user notification routing (email + future Slack); pause-on-failure policy         |
| 3     | Built-in tools    | Anthropic `web_search`, `code_execution` — start the tool-config data model           |
| 4     | Outbound email    | Agent gets a dedicated send-only SES identity restricted to the user's verified email |
| 5     | Read-only MCP     | Notion, Gmail, Calendar via per-agent OAuth                                           |
| 6     | GitHub PRs        | Agent can open PRs on a per-repo allowlist                                            |
| 7     | Multi-user        | Admin / viewer roles per agent; org-scoped Cognito groups                             |
| 8     | Retention + audit | Retention policies + an audit-summarizer agent over old runs                          |

Each phase reuses the harness from Phase 0. No new top-level concerns unless an [ADR](../adr/README.md) justifies it.
