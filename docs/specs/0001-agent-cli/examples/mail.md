# mail — a paper example

> **This is a paper design. Nothing here is built.** No recipe file exists under `recipes/`, no
> credential is configured, nothing deploys, and no acceptance criterion depends on it. It earns its
> place by the constraint it puts on the schema and by the capability it proves is out of reach.

Provider-agnostic mail over SMTP and IMAP, authenticating with a password or app-password. It is the
one target considered for [spec 0001](../spec.md) that **fits neither rendering**: it is not an
argv-driven binary this project controls, and it is not an HTTP API.

## The finding

A `cli` target is a binary the auth process spawns. An `http` target is an API it calls at a fixed
origin. SMTP and IMAP are neither — they are stateful, long-lived, server-speaks-first protocols. Four
options were considered.

| Option                                                                | Cost                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wrap an existing binary (`msmtp`, `himalaya`) as a `cli` target       | Puts **two unvetted third-party executables on the credentialed host**, inside the auth process's spawn set, both far smaller projects than `gh` and so likelier to churn their grammar — existing only so a worked example executes |
| Add a third rendering kind with a protocol client in the auth process | A new dependency, a new unconfined component, and a reintroduction of message composition — which is a stated non-goal for a security reason, not a scheduling one                                                                   |
| Replace it with a provider's HTTP mail API                            | That is [gmail](gmail.md), which is already here and already shows the OAuth story                                                                                                                                                   |
| **Keep it as a paper design**                                         | 0001 executes no SMTP send, so the `email` argument type and the `argDomainIn` predicate ship with no _executed_ user                                                                                                                |

**The last was chosen.** Every property mail was picked to span is covered elsewhere:
[github](github.md) gives a scoped credential and the `cli` kind, [slack](slack.md) gives a rotating
bearer and an irreversible outward verb with an enumerable destination, [gmail](gmail.md) gives the
OAuth refresh story. What remains unique to mail is a **negative** result, and a negative result does
not need a binary to be true.

`msmtp` is genuinely a good fit for this spec's constraints — long flags, recipients as positional
argv, the body opaque on stdin, configuration from a file the config root would contain — and it would
be the best illustration of `neverModel` anywhere in the spec. That is not enough to put it on the
credentialed host in the first spec.

## The sketch that keeps the schema honest

Paper, but written against the frozen schema, because that is what makes it evidence. This is what an
`msmtp`-shaped recipe would be:

```json
{
  "$schema": "../schemas/recipe.json",
  "name": "mail",
  "kind": "cli",
  "target": { "exec": "msmtp", "version": "1.8.25" },
  "credential": { "kind": "password", "boundVia": "file" },
  "configRoot": "/var/lib/agent-cli/config/mail",
  "concurrency": { "key": "credential", "max": 1, "queueMaxMs": 5000 },
  "neverModel": ["-t", "--read-recipients", "--read-envelope-from"],
  "limits": { "stdinMaxBytes": 262144, "execMs": 30000 },
  "verbs": [
    {
      "name": "send",
      "match": ["send"],
      "effect": "irreversible-outward",
      "destination": ["to"],
      "args": [
        { "name": "to", "type": "email", "positional": true, "repeated": true, "required": true },
        { "name": "from", "flag": "--from", "type": "email", "required": true }
      ],
      "stdin": { "kind": "opaque", "maxBytes": 262144 }
    }
  ]
}
```

`neverModel` is the load-bearing line, and this is the clearest example of it in the spec: `-t`,
`--read-recipients` and `--read-envelope-from` all make **headers inside the message body determine the
recipients**. Model any one of them and the body — which is opaque, capped and digested but never
parsed — silently becomes the destination, while a reviewer reads an `argDomainIn` allowlist and
believes the destination is bounded. `check` fails a recipe that models a `neverModel` token.

Two policies, to show the split holds here too:

```json
{
  "name": "mail-internal",
  "recipe": "mail",
  "intent": "Let the report agent mail summaries to colleagues, inside our domain only.",
  "default": "deny",
  "budget": { "perHour": 20, "perVerb": { "send": 10 } },
  "rules": [
    {
      "id": "R1",
      "when": {
        "verb": "send",
        "argDomainIn": { "to": ["agent-village.test"] },
        "argCountAtMost": { "to": 5 }
      },
      "action": "allow",
      "why": "Internal recipients only. Mail cannot be unsent, so the domain is enumerated and the recipient count is bounded so one invocation cannot become a broadcast."
    }
  ]
}
```

```json
{
  "name": "mail-owner-only",
  "recipe": "mail",
  "intent": "Let a monitoring agent mail exactly one address: the owner.",
  "default": "deny",
  "budget": { "perHour": 4 },
  "rules": [
    {
      "id": "R1",
      "when": {
        "verb": "send",
        "argEquals": { "to": "owner@agent-village.test" },
        "argCountAtMost": { "to": 1 }
      },
      "action": "allow",
      "why": "An alerting path should reach one person and no one else, so the destination is a single literal rather than a domain."
    }
  ]
}
```

These two are why keeping the paper example is not free sentiment: they are the only illustration in
the spec of the `email` argument type and the `argDomainIn` predicate, which AC-2.7 is verified against
as a **seeded fixture** rather than a shipped recipe. Whether they survive with no executed user is
**open question Q14** — the recommendation is keep, because cutting them deletes AC-2.7 outright,
removes a destination-qualifying predicate G11 leans on, and turns a mail-shaped fifth target into a
policy-schema change, which would weaken DG5.

## What this strains

| Strain                                                | What happens                                                                                                                                                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SMTP/IMAP fits neither rendering                      | Not wrapped in this spec. "Shipping a target binary" is a stated non-goal, and so is composing messages                                                                                                                            |
| Recipients conventionally live inside the message     | Unwrappable by construction. Recipients must be typed argv arguments; stdin is opaque, capped, digested, never parsed, and never a value named in `destination`                                                                    |
| A CRLF in a subject line                              | The reason message composition is cut at all: it injects a `Bcc:` header and defeats every recipient allowlist. Not building a composer removes the attack, an unnamed component, and a dependency                                 |
| One `email` value expanding to several recipients     | `email` is a strict single addr-spec — no display name, no angle brackets, no comma, semicolon or whitespace, no quoted local part, no control bytes, NFC-normalized — and `argDomainIn` matches the validated domain part exactly |
| IMAP is a long-lived stateful session                 | Out of scope for a different reason: **agent-cli mediates invocations, not connections.** "Mediating sessions rather than invocations, including IMAP IDLE and REPLs" is a stated non-goal                                         |
| Sending is irreversible and partial failure is normal | A multi-recipient send that partly succeeds is not reported — "partial success of a multi-recipient action is not reported" is in Deliberately-not-guaranteed                                                                      |

## The cost, stated

This spec proves "agent-cli wraps arbitrary third-party CLIs" **once** ([github](github.md)) and argues
it twice. `email` and `argDomainIn` ship without an executed user. Both facts are written down here
rather than discovered later, and Q14 is the owner's decision on the second.
