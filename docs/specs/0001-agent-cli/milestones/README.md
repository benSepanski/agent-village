# Milestones — agent-cli

Buildable slices of [spec 0001](../spec.md). Each carries its own criteria, numbered `AC-M<n>.<k>`,
each tracing to the spec criterion it serves. QA passes are indexed in [qa/](../qa/README.md).

| Milestone                                                                      | Slice                                                                                                                                              | Status  | QA  |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --- |
| [M1 — gh read, end to end](M1-gh-read-end-to-end.md)                           | One `gh` read verb runs end to end through a shim, a per-wrap socket and the auth process, and the authoring cost of both target kinds is measured | Planned | —   |
| [M2 — containment: filesystem and wire](M2-containment-filesystem-and-wire.md) | A staged file argument and a recipe-constructed environment on one boundary; the `http` emitter's observed wire bytes on the other                 | Planned | —   |
| [M3 — policies and gates](M3-policies-and-gates.md)                            | The policy schema freezes, every `check` gate bites, a second `gh` policy ships, and `deploy`/`revoke`/`retire` are the only ways in and out       | Planned | —   |
| [M4 — slack, an http target](M4-slack-http-target.md)                          | Slack deploys with a rotating bearer credential bound to one origin and a destination-constrained irreversible send                                | Planned | —   |
| [M5 — maintenance and retention](M5-maintenance-and-retention.md)              | `doctor` classifies drift and quarantines a `cli` wrap, `observe` proposes and applies nothing, retention drops whole day-files at both bounds     | Planned | —   |
| [M6 — approver and spec QA](M6-approver-and-spec-qa.md)                        | An `ask` rule consults the approver inside an already-bounded destination, and the spec is QA'd against every criterion                            | Planned | —   |

Ordering: M1 exercises the riskiest assumption — that a target's help tree yields a usable verb
grammar at an affordable authoring cost — and the `http` work is split along its dependency on
secrets, so the emitter fails in M2 with no credential and no network rather than in M4 with both.

Guides: [decompose-into-milestones](../../../dev/workflows/decompose-into-milestones.md),
[execute-a-milestone](../../../dev/workflows/execute-a-milestone.md).
