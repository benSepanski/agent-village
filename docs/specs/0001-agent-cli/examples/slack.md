# slack — an `http` target

The Slack Web API at a recipe-fixed origin, with a bearer credential that rotates, and two policies
over one recipe. It is the example that carries AC-7.2 alone: of the four targets considered, it is the
only one with **both** a refreshable credential **and** a wrappable irreversible-outward verb, so it
tests the interaction between a rotation and an interrupted send rather than testing each separately.

Shipped, in M4. Every rule below obeys the normative rendering rules R1–R14 in
[the spec](../spec.md#rendering-rules--http).

## The recipe

`recipes/slack.recipe.json`. The origin is three constants; no argument type can bind into it, no verb
can override it, and no response can name one (G17).

```json
{
  "$schema": "../schemas/recipe.json",
  "name": "slack",
  "kind": "http",
  "target": { "origin": "https://slack.com", "pathPrefix": ["api"] },
  "credential": {
    "kind": "bearer",
    "boundVia": "header",
    "headerName": "authorization",
    "format": "Bearer {}"
  },
  "concurrency": { "key": "credential", "max": 4, "queueMaxMs": 5000 },
  "limits": { "requestBodyMaxBytes": 16384, "responseMaxBytes": 1048576, "execMs": 15000 },
  "verbs": [
    {
      "name": "conversations.list",
      "method": "GET",
      "effect": "read",
      "evidence": "Slack API conversations.list: returns channel metadata only; documented as read-only, no side effects.",
      "request": {
        "path": ["conversations.list"],
        "query": {
          "types": { "arg": "types" },
          "limit": { "arg": "limit" },
          "exclude_archived": { "fixed": "true" }
        }
      },
      "body": { "kind": "none" },
      "args": [
        { "name": "types", "type": "enum", "values": ["public_channel", "private_channel"] },
        { "name": "limit", "type": "int", "min": 1, "max": 200 }
      ]
    },
    {
      "name": "conversations.history",
      "method": "GET",
      "effect": "read",
      "evidence": "Slack API conversations.history: returns messages; documented as read-only.",
      "request": {
        "path": ["conversations.history"],
        "query": { "channel": { "arg": "channel" }, "limit": { "arg": "limit" } }
      },
      "body": { "kind": "none" },
      "args": [
        {
          "name": "channel",
          "type": "string",
          "pattern": "^[CGD][A-Z0-9]{8,20}$",
          "required": true
        },
        { "name": "limit", "type": "int", "min": 1, "max": 200 }
      ]
    },
    {
      "name": "chat.post",
      "method": "POST",
      "effect": "irreversible-outward",
      "destination": ["channel"],
      "evidence": "Slack API chat.postMessage: posts a visible message to a channel. Deletion requires a separate call and does not un-notify; treated as irreversible.",
      "request": { "path": ["chat.postMessage"], "query": {} },
      "body": {
        "kind": "json",
        "fields": {
          "channel": { "arg": "channel" },
          "text": { "arg": "text" },
          "unfurl_links": { "fixed": false }
        }
      },
      "args": [
        {
          "name": "channel",
          "type": "string",
          "pattern": "^[CGD][A-Z0-9]{8,20}$",
          "required": true
        },
        { "name": "text", "type": "text", "maxBytes": 4000, "required": true }
      ]
    }
  ]
}
```

Read against R1–R14, the things that are **absent** are doing the work:

- No field anywhere holds a URL, a request-target, a method, a header name, or a query string. The
  origin is a constant and the method is a constant. That absence — not a check — is why a host or
  scheme swap is unexpressible (G17).
- `headers` is not declared at all, and could only hold recipe **literals** if it were. There is no
  binding syntax in a header position, which makes CRLF injection unexpressible rather than filtered
  (R6). `content-type` is derived from `body.kind`, so the serializer and the media type cannot
  disagree.
- `chat.post`'s body is one level deep. Structured Slack payloads (Block Kit) need nesting, so they are
  unwrappable here — the same cut as message composition, for the same reason.
- `channel` is a `string` with an anchored `pattern`, which is what R4 requires of anything that could
  reach a segment, and what makes it usable as a destination.

## The two policies

`policies/slack-readonly.policy.json`:

```json
{
  "$schema": "../schemas/policy.json",
  "name": "slack-readonly",
  "recipe": "slack",
  "intent": "Let a summarizing agent read channel history. It never posts.",
  "default": "deny",
  "budget": { "perHour": 300 },
  "rules": [
    {
      "id": "R1",
      "when": { "verbIn": ["conversations.list", "conversations.history"] },
      "action": "allow",
      "why": "Reading is the whole job, and the credential for this wrap carries read scopes only."
    }
  ]
}
```

`policies/slack-announce.policy.json` — the second policy over the same recipe:

```json
{
  "$schema": "../schemas/policy.json",
  "name": "slack-announce",
  "recipe": "slack",
  "intent": "Let the release agent post build results to two channels, and read anywhere it can already see.",
  "default": "deny",
  "budget": { "perHour": 300, "perVerb": { "chat.post": 12 } },
  "rules": [
    {
      "id": "R1",
      "when": { "verb": "chat.post", "argIn": { "channel": ["C07J4Q2ZK3M", "C08A1BB7X2Q"] } },
      "action": "allow",
      "why": "C07J4Q2ZK3M is #deploys and C08A1BB7X2Q is #build-alerts, both resolved 2026-08-01. A post is public and cannot be un-notified, so the destination is enumerated rather than patterned."
    },
    {
      "id": "R2",
      "when": { "verbIn": ["conversations.list", "conversations.history"] },
      "action": "allow",
      "why": "The release agent reads the channel before posting so it can avoid duplicating an existing announcement."
    }
  ]
}
```

`R1` is the shape G11 requires: `channel` is the declared `destination`, and it is constrained by
`argIn` over an enumerated set. `check` fails the same rule with `argIn` removed, and — importantly —
also fails it if the only constraint is `argCountAtMost` or a `budget`, because neither says anything
about **where** the message lands.

The channel identifiers are opaque, and that is a real cost. `C07J4Q2ZK3M` means nothing to a reviewer,
so the human label lives in the rule's required `why`. Re-resolving a pin at `doctor` time was
considered and rejected: it would be an unaudited credentialed call to a third party, made by the
maintenance tool.

## The wraps and the trials

```json
{
  "name": "slack-readonly",
  "recipe": "slack",
  "policy": "slack-readonly",
  "credential": { "id": "slack-ro", "version": 7 },
  "command": "slack",
  "grants": ["summarize"]
}
```

```json
{
  "name": "slack-announce",
  "recipe": "slack",
  "policy": "slack-announce",
  "credential": { "id": "slack-post", "version": 4 },
  "command": "slack",
  "grants": ["release"]
}
```

`trials/slack-announce.trials.json`:

```json
{
  "policy": "slack-announce",
  "cases": [
    {
      "argv": ["conversations.history", "--channel", "C07J4Q2ZK3M", "--limit", "50"],
      "expect": { "verdict": "allow", "rule": "R2" }
    },
    {
      "argv": ["chat.post", "--channel", "C07J4Q2ZK3M", "--text", "build 8123 green"],
      "expect": { "verdict": "allow", "rule": "R1" }
    },
    {
      "argv": ["chat.post", "--channel", "C0GENERAL99", "--text", "hello"],
      "expect": { "verdict": "deny", "reason": "no-matching-rule" }
    },
    {
      "argv": ["chat.post", "--channel", "C07J4Q2ZK3M/../admin", "--text", "x"],
      "expect": { "verdict": "deny", "reason": "type-refused" }
    },
    { "argv": ["users.list"], "expect": { "verdict": "deny", "reason": "unmapped-verb" } }
  ]
}
```

A trial over an `ask` rule would assert the **routing** — which rule matched, and that its action is
`ask` — never the model's answer. That is what keeps the corpus deterministic and offline with no
pinning machinery at all.

## What this strains

| Strain                                                                                          | What happens                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Posts are public and cannot be un-notified                                                      | `effect: "irreversible-outward"`, a required `destination`, and `check` refusing any allow rule that leaves it unconstrained. `budget.perVerb` bounds the damage of a retry loop                                                                                                 |
| Channel identifiers are opaque and their meaning lives upstream                                 | The human label lives in the rule's `why`. If `#deploys` is renamed or the id reassigned, nothing detects it — stated, not solved                                                                                                                                                |
| The bearer token rotates                                                                        | Rotation runs under the same credential-keyed lock as invocation, so two wraps never hold it concurrently and `credential.bound` never records two versions across overlapping executions (G15)                                                                                  |
| **Slack signals authorization failure as HTTP 200** with `{"ok":false,"error":"missing_scope"}` | Under R11 that is a success: exit 0, error body on stdout. Detecting it needs response-body parsing, which Scoping guidance forbids. **This is why AC-7.2 carries no drift clause and why AC-6.1 is `cli`-only.** Open question Q15                                              |
| An `http` target has no surface to introspect                                                   | **G14 does not hold.** There is no local artifact to re-run, no version to pin, no surface map — `surfaceDigest` is `null` on every record, meaning this recipe makes no checkable claim about its target's surface. `doctor` has nothing to diff and the quarantine never fires |
| Block Kit and other structured payloads                                                         | Unwrappable. R8 permits one level of nesting: a value is a scalar or an array of scalars, never an object                                                                                                                                                                        |
| File upload and cursor pagination name their next hop in the response                           | Unwrappable. R11 never follows a redirect and never re-issues, because a response that determines part of a request makes the server an author of the request                                                                                                                    |
| A caller-supplied idempotency key                                                               | Unwrappable as a header (R6 admits literals only). It would have to move to a query value, or the verb goes unwrapped                                                                                                                                                            |
| Effect classification rests on provider prose                                                   | `evidence` is required and lintable for presence. **It makes the classification reviewable and diffable, not true** — providers use POST for search and GET for triggers                                                                                                         |

## Criteria this example serves

AC-7.2 (two policies, rotation under the lock, a destination-constrained send), AC-7.3
(`outcome: unknown` on interruption), AC-2.8 (the escape corpus over every bound and literal position),
AC-2.9 (origin fixing and credential-origin binding), AC-5.1 (the three-file increment, proven
kind-blind alongside [github](github.md)).
