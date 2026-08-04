# Worked examples

| You want to know                                                                     | Kind   | Status  | Read                   |
| ------------------------------------------------------------------------------------ | ------ | ------- | ---------------------- |
| What wrapping a real third-party binary looks like, end to end                       | `cli`  | Shipped | [github.md](github.md) |
| What wrapping an API at a recipe-fixed origin looks like, with a rotating credential | `http` | Shipped | [slack.md](slack.md)   |
| What an OAuth-refreshed API looks like, and which of its verbs stays unwrappable     | `http` | Paper   | [gmail.md](gmail.md)   |
| What happens when a target is neither a packaged binary nor an API                   | —      | Paper   | [mail.md](mail.md)     |

These documents are [the spec](../spec.md)'s evidence that the recipe and policy schema generalizes:
each writes one recipe and two policies for a real target against the frozen schema, and reports what
that target strains. A **shipped** target executes — its artifacts live under `recipes/`, `policies/`,
`wraps/` and `trials/`, pass `check`, and are named in an acceptance criterion. A **paper** target is a
design that shapes the schema without being executed: a target that exists as neither a third-party
CLI nor an API is not wrapped here, so it ships no artifact, holds no credential, deploys nothing, and
is named in no acceptance criterion — it earns its place by the constraint it puts on the schema and by
the capability it proves is out of reach. Where a target exists in both forms, the kind is not a free
choice: prefer `cli` whenever a packaged, non-interactive, argv-driven binary exists, because `cli` is
the kind that gets a scaffolder and a re-runnable local artifact for drift.
