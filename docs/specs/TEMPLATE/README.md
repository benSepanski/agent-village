# Spec templates

The canonical skeletons. There is exactly one copy of each — a spec directory links here rather than
carrying its own, so the templates cannot drift per spec.

| File                               | Use for                                 | Guide                                                                         |
| ---------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| [spec.md](spec.md)                 | A design spec                           | [author-a-spec](../../dev/workflows/author-a-spec.md)                         |
| [milestone.md](milestone.md)       | One buildable slice of an Accepted spec | [decompose-into-milestones](../../dev/workflows/decompose-into-milestones.md) |
| [qa-milestone.md](qa-milestone.md) | QA of a milestone                       | [qa-a-milestone](../../dev/workflows/qa-a-milestone.md)                       |
| [qa-spec.md](qa-spec.md)           | QA of a spec as a whole                 | [qa-a-spec](../../dev/workflows/qa-a-spec.md)                                 |

## Starting a new spec

```bash
mkdir -p docs/specs/NNNN-<slug>/{milestones,qa}
cp docs/specs/TEMPLATE/spec.md docs/specs/NNNN-<slug>/spec.md
```

Then add a row to the index in [../README.md](../README.md). `milestones/` and `qa/` stay empty
until the spec is Accepted; each gets a `README.md` index when its first document lands.

This directory is a template, not a spec — it never appears in the spec index and is never built.
