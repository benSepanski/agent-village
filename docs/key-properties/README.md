# Key properties

Properties someone should understand before launching or operating this system, and **how each one is enforced in code** — with links to the enforcing mechanism, not just a description. Each page also lists the known limits of the enforcement.

| Property                                                   | File                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| How AWS + Anthropic costs are controlled                   | [aws-cost-control](aws-cost-control.md)               |
| Which AWS account and region get deployed to               | [aws-account-and-region](aws-account-and-region.md)   |
| How multiple deployments coexist without colliding         | [multiple-deployments](multiple-deployments.md)       |
| How users authenticate and how identity is derived         | [user-auth](user-auth.md)                             |
| Where agent state is persisted                             | [agent-state-persistence](agent-state-persistence.md) |
| How one user's/agent's state is isolated from another's    | [agent-state-isolation](agent-state-isolation.md)     |
| What happens when concurrent requests touch the same state | [concurrent-state-access](concurrent-state-access.md) |

## Reading these pages

Each page follows the same shape:

1. **The property** — one sentence stating the guarantee.
2. **Enforcement** — the concrete mechanisms in code (IAM policy, conditional write, CDK construct, …), each linked to its source.
3. **Known limits** — where the guarantee stops. These are deliberate at current scale; treat them as input to a launch review, not as bugs.

If you change any linked mechanism, update the corresponding page in the same PR — these pages are the launch-review contract.
