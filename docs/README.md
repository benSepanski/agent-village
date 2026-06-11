# Docs

Each link below answers one question in one screen. Pattern-match against the question and click through.

## I'm new — what do I read first?

1. [Architecture topology](architecture/topology.md) — what AWS components exist and how requests flow through them.
2. [Layered packages](architecture/layered-packages.md) — what each `packages/*` directory is for, and what's allowed to import from what.
3. [Codebase map](architecture/codebase-map.md) — where the code for any given concern lives.
4. [The three-tier permission rule](permissions/README.md) — what an agent (you) may do without asking, must ask first, and must never do.

## I'm reviewing this system before launch / operating it

[key-properties/](key-properties/README.md) explains, with code links, **how** each load-bearing guarantee is enforced — and where it stops:

| Property                             | File                                                                 |
| ------------------------------------ | -------------------------------------------------------------------- |
| Cost control (AWS + Anthropic)       | [aws-cost-control](key-properties/aws-cost-control.md)               |
| Which AWS account/region is targeted | [aws-account-and-region](key-properties/aws-account-and-region.md)   |
| How multiple deployments coexist     | [multiple-deployments](key-properties/multiple-deployments.md)       |
| User authentication                  | [user-auth](key-properties/user-auth.md)                             |
| Where agent state persists           | [agent-state-persistence](key-properties/agent-state-persistence.md) |
| How state is isolated per user/agent | [agent-state-isolation](key-properties/agent-state-isolation.md)     |
| Concurrent access to the same state  | [concurrent-state-access](key-properties/concurrent-state-access.md) |

## I'm about to write code

| Question                                | Answer                                                        |
| --------------------------------------- | ------------------------------------------------------------- |
| How do I log?                           | [structured-logging](conventions/structured-logging.md)       |
| How do I validate inputs from outside?  | [schemas-at-boundaries](conventions/schemas-at-boundaries.md) |
| How do I handle errors?                 | [error-handling](conventions/error-handling.md)               |
| What are the file/function size limits? | [file-size-bounds](conventions/file-size-bounds.md)           |
| Where can I import from?                | [module-boundaries](conventions/module-boundaries.md)         |
| Should I add a comment?                 | [comments](conventions/comments.md)                           |
| How do I name things?                   | [naming](conventions/naming.md)                               |

## I'm about to add an X

| You want to add                        | Read                                                                  |
| -------------------------------------- | --------------------------------------------------------------------- |
| A Lambda (HTTP or scheduled)           | [add-lambda](playbooks/add-lambda.md)                                 |
| A frontend route                       | [add-frontend-route](playbooks/add-frontend-route.md)                 |
| Behavior for an environment            | [deploy-env](playbooks/deploy-env.md)                                 |
| Anthropic key rotation                 | [rotate-anthropic-key](playbooks/rotate-anthropic-key.md)             |
| (manual) experimentation with an agent | [experiment-with-an-agent](playbooks/experiment-with-an-agent.md)     |
| A new architectural decision           | [adr/TEMPLATE](adr/TEMPLATE.md) + read the [ADR index](adr/README.md) |

## I'm working on the data layer

| Question                               | Answer                                               |
| -------------------------------------- | ---------------------------------------------------- |
| What does the table look like?         | [table-keys](data-model/table-keys.md)               |
| What's a User item?                    | [user entity](data-model/user.md)                    |
| What's an Agent item?                  | [agent entity](data-model/agent.md)                  |
| What's a Run item?                     | [run entity](data-model/run.md)                      |
| How does spend-limit enforcement work? | [spend-reservation](data-model/spend-reservation.md) |
| How long do we keep runs?              | [run-retention](data-model/run-retention.md)         |

## I'm working on observability

| Question                                | Answer                                                        |
| --------------------------------------- | ------------------------------------------------------------- |
| What logs are emitted?                  | [observability](architecture/observability.md)                |
| What's the structured-log envelope?     | [structured-logging](conventions/structured-logging.md)       |
| How do I trace a single run end-to-end? | [observability](architecture/observability.md#tracing)        |
| How does the in-app dashboard work?     | [observability](architecture/observability.md#in-app-surface) |

## I'm working on infrastructure or deploy

| Question                        | Answer                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| What environments exist?        | [environments](architecture/environments.md)                                        |
| How do sandboxed app runs work? | [sandbox-runs](architecture/sandbox-runs.md)                                        |
| How are costs guarded?          | [cost-guards](architecture/cost-guards.md)                                          |
| How do I deploy?                | [deploy-env](playbooks/deploy-env.md)                                               |
| What permissions does CI need?  | [deploy-env#one-time-setup](playbooks/deploy-env.md#one-time-setup-per-environment) |

## I'm trying to understand "why X?"

- [Harness engineering principles](conventions/harness-engineering.md) — why the repo is shaped the way it is and the operating rules behind the linters/schemas/CI. Read only if you're designing new harness pieces or debating a rule.
- [Past architecture decisions (ADRs)](adr/README.md) — append-only log of decisions and their reasoning.
- [Phase plans](phases/README.md) — what each project phase delivers and why.

## I'm picking up the project mid-flight

- [What Phase 0 delivered](phases/phase-0-harness.md) — the harness already in place.
- [Phase 1 — MVP](phases/phase-1-mvp.md) — delivered; the spec plus known deviations as shipped.
- [Phase 2 — sandboxed application runs](phases/phase-2-sandbox-runs.md) — active; the step table shows what's landed.
- [Phase 3+ roadmap](phases/phase-2-plus.md) — sketched, not detailed.
