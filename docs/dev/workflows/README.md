# Workflows

One guide per step of the two loops ([../../../CONTRIBUTING.md](../../../CONTRIBUTING.md)). Each says
what to do, what to produce, and what makes the step done.

## Outer loop — reaching and closing a spec

| Step                            | Guide                               |
| ------------------------------- | ----------------------------------- |
| Write or revise a design spec   | [author-a-spec](author-a-spec.md)   |
| Close a spec out, either ending | [archive-a-spec](archive-a-spec.md) |

## Inner loop — building an accepted spec

| Step                       | Guide                                                     |
| -------------------------- | --------------------------------------------------------- |
| Break the spec into slices | [decompose-into-milestones](decompose-into-milestones.md) |
| Build one slice            | [execute-a-milestone](execute-a-milestone.md)             |
| Check that slice           | [qa-a-milestone](qa-a-milestone.md)                       |
| Check the spec as a whole  | [qa-a-spec](qa-a-spec.md)                                 |

## Any time

| Step              | Guide                           |
| ----------------- | ------------------------------- |
| Record a decision | [write-an-adr](write-an-adr.md) |

## If you do not know which step you are on

Ask these in order:

1. Is there an `Accepted` spec with unfinished milestones? → [execute-a-milestone](execute-a-milestone.md).
2. Is there an `Accepted` spec with no milestones? → [decompose-into-milestones](decompose-into-milestones.md).
3. Is there a milestone marked Complete but never QA'd? → [qa-a-milestone](qa-a-milestone.md).
4. Are all milestones done? → [qa-a-spec](qa-a-spec.md), then [archive-a-spec](archive-a-spec.md).
5. Is there a `Draft` spec? → [author-a-spec](author-a-spec.md).
6. None of the above? → there is no work authorized. Report that and ask the owner for the next
   spec. Do not invent one.
