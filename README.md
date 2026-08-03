# agent-village

A toolkit for building agentic applications: give an agent real capabilities and real data, inside
a boundary you can describe, audit, and afford.

> **Status: design phase.** The previous implementation was scrapped and archived under
> [docs/legacy/v0/](docs/legacy/v0/), and no code has landed since. Implementation is gated on an
> accepted design spec in [docs/specs/](docs/specs/); the first is in draft. Everything below is
> **intent**, not a description of working software.

## What we intend to build

Three components, layered but independently useful.

### agent-cli

A wrapper that turns any CLI into a sandbox-safe one. The wrapper runs inside the sandbox with no
credentials; the real credentials live in a separate **auth process** outside it. The wrapper
forwards each invocation to that process, which approves or denies it — programmatically, or by
asking a model — and returns the response, optionally with feedback explaining the decision.

The point: an agent can use `gh`, `aws`, or `curl` without ever holding the token, and every use is
a decision someone can review.

### agent-environment

- **Agent** — a filesystem that can be mounted.
- **Agent instance** — that filesystem plus a coding agent (a model and a harness) running against it.
- **Environment** — a sandbox with one or more filesystems mounted, possibly including agents. An
  environment is a set of capabilities and data an agent can reach.
- **Bridge** — the only egress. A bridge decides, programmatically or via its own agent, what may
  cross between an environment and the wider network or another environment.
- **Agent application** — a set of environments and bridges, with one bridge as the entry point.

Applications may be one-shot or long-lived and interactive, but an application runs on **one logical
compute unit**. Docker is the expected first runtime; the runtime interface is meant to be more
general, with an off-the-shelf Docker implementation.

### agent-server

Deploying and operating an application built on the above:

- Whitelisted people register with a Google account; registered users create and run **instances** of
  an application (e.g. several instances of a D&D assistant, one per campaign), and can inspect past
  sessions of non-persistent ones.
- **Cost is bounded by construction.** The deployer fixes the maximum number of simultaneously
  running machines; work beyond that is prioritized and queued rather than scaled into.
- Instance filesystems persist to S3 with strict separation between instances and between users.
- Common triggers start runs; idle-capable applications (a chatbot) stay resident when possible.
- Agent logs from sessions are inspectable, up to explicit size and age bounds, after which they are
  dropped.

## Design goals

1. **AI-native codebase** — legible and safely modifiable by agents, with rules enforced by
   mechanisms rather than by remembering prose.
2. **Modularity** — components with stated contracts, replaceable without rewriting their neighbours.
3. **Simplicity** — the fewest moving parts that satisfy the spec.

See [docs/dev/design-principles.md](docs/dev/design-principles.md) for what these mean concretely.

## Where to start

| You are                                  | Start at                           |
| ---------------------------------------- | ---------------------------------- |
| An agent working in this repo            | [AGENTS.md](AGENTS.md)             |
| A person contributing                    | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Looking for any document                 | [docs/README.md](docs/README.md)   |
| Looking for the binding design           | [docs/specs/](docs/specs/)         |
| Wondering why something is the way it is | [docs/adr/](docs/adr/)             |

## Working in this repo

```bash
pnpm install
pnpm check
```

`pnpm check` is the whole harness today: Prettier formatting plus a relative-link check across the
docs. See [docs/dev/README.md](docs/dev/README.md).
