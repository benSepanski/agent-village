# Milestones — agent-environment

Decomposition of [spec 0002](../spec.md), per
[decompose-into-milestones](../../../dev/workflows/decompose-into-milestones.md). Ordered by
dependency; each milestone is buildable and checkable without the ones after it.

| Milestone                                                   | Slice                                                                      | Status   | QA                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- | -------- | ---------------------------------------------------- |
| [M1-walking-skeleton](M1-walking-skeleton.md)               | One environment, no network, one program-decided crossing, journaled       | Complete | [Pass with follow-ups](../qa/M1-walking-skeleton.md) |
| [M2-topology-checker](M2-topology-checker.md)               | Every declaration the spec says to refuse is refused, with a reason        | Planned  | —                                                    |
| [M3-volumes-and-activations](M3-volumes-and-activations.md) | Declared mounts enforced; session volumes reset; activations begin and end | Planned  | —                                                    |
| [M4-wakeups-turns-leases](M4-wakeups-turns-leases.md)       | Wakeups start turns; the write lease serialises them; queueing is recorded | Planned  | —                                                    |
| [M5-mediated-volumes](M5-mediated-volumes.md)               | Pinned read-only mounts; every change to a mediated volume is a crossing   | Planned  | —                                                    |
| [M6-ingress-flows-taint](M6-ingress-flows-taint.md)         | An admitted message mints a flow and a taint set; refusals aggregate       | Planned  | —                                                    |
| [M7-egress-decisions](M7-egress-decisions.md)               | Flow invariants, auth-environment deciders, deferral, at-most-once         | Planned  | —                                                    |
| [M8-audit-stores-retention](M8-audit-stores-retention.md)   | Two stores, retention bounds, and reconstruction from one flow identifier  | Planned  | —                                                    |
| [M9-driving-applications](M9-driving-applications.md)       | Mail, DM, and campaign fixtures run end to end on loopback, disconnected   | Planned  | —                                                    |

## Coverage

Every spec acceptance criterion, and the milestone that serves it:

| Spec criteria                  | Served by                                             |
| ------------------------------ | ----------------------------------------------------- |
| AC-1.1 – AC-1.5                | M2                                                    |
| AC-1.6                         | M2 (checker output), M5 (`topology.declared` journal) |
| AC-2.1                         | M1                                                    |
| AC-2.2, AC-2.4                 | M3                                                    |
| AC-2.3                         | M4                                                    |
| AC-2.5                         | M5                                                    |
| AC-3.1                         | M5                                                    |
| AC-3.2, AC-3.4                 | M1                                                    |
| AC-3.3, AC-3.5 – AC-3.7        | M7                                                    |
| AC-4.1, AC-4.2, AC-4.4, AC-4.5 | M8                                                    |
| AC-4.3                         | M6                                                    |
| AC-5.1                         | M3                                                    |
| AC-5.2                         | M4 (mechanism, loopback fixture), M9 (DM fixture)     |
| AC-6.1, AC-6.2                 | M9                                                    |

## Where the risk sits

M1 exercises the spec's riskiest assumption — that a loopback-only network namespace the
application cannot modify, plus a non-routable local channel to a bridge, is achievable on the
Docker runtime. M4 and M5 carry the other two runtime-feasibility risks named in the spec's open
questions: write-lease latency and pinned snapshots. All three land in the first half so a
nonviable spec fails cheap.
