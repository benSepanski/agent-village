# Comments

Default: **don't**.

## When to write one

When the **why** is non-obvious and a future reader (or future you) would otherwise have to dig:

- A subtle invariant ("`lastModified` is set by the trigger, not the writer").
- A workaround for an external bug ("Anthropic returns 200 for malformed JSON; check `usage` field instead").
- A constraint that explains a counter-intuitive choice ("must run before `MonitoringStack` because the budget references the topic ARN").

## When NOT to write one

- To explain **what** the code does — names should already do that.
- To reference the current task or PR — that belongs in the commit message.
- To name callers ("used by X") — that rots; the IDE knows.
- To re-state a type that's already in the signature.

## Doc comments

- One short line above exported functions/classes is fine when it adds intent beyond the name.
- Don't write multi-paragraph JSDoc. If you need that much explanation, the function is doing too much (see [file-size-bounds](file-size-bounds.md)) or the API isn't carving the problem at the right joint.
