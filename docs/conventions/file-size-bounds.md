# File / function size bounds

All errors, never warnings. Set in [`.eslintrc.cjs`](../../.eslintrc.cjs).

| Metric                | Bound     | Rule                     |
| --------------------- | --------- | ------------------------ |
| Cyclomatic complexity | 10        | `complexity`             |
| Max nesting depth     | 4         | `max-depth`              |
| Function length       | 50 lines  | `max-lines-per-function` |
| File length           | 300 lines | `max-lines`              |
| Function parameters   | 4         | `max-params`             |
| Function statements   | 15        | `max-statements`         |

## What to do when one fires

The fix is almost always **"extract a helper"**:

- 51-line function → split into two named functions, each doing one thing.
- File at 301 lines → split by topic into multiple files in the same directory.
- 5 parameters → take an options object.
- Complexity > 10 → too many branches; turn switch chains into a lookup table.

## Don't suppress

Inline `eslint-disable` is forbidden by `eslint-comments/no-use`. If a bound is truly wrong for one place, that's an [ADR](../adr/README.md), not a one-off suppression.

## Tests are exempt

Test files (`**/*.test.ts`, `**/*.spec.ts`, `tests/**/*.ts`) opt out of the function-length, statement, and file-length bounds because test bodies are long by nature. Complexity and depth still apply.
