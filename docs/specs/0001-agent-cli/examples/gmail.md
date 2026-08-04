# gmail — a paper example

**This is a paper design. It shapes the schema and is not built.** No recipe, policy, wrap or trials
file exists for it under `recipes/`, `policies/`, `wraps/` or `trials/`; no credential is configured;
nothing deploys, nothing executes, and no acceptance criterion in [spec.md](../spec.md) depends on
it. Read it as design evidence, never as a shipped wrap — the shipped `http` example is
[slack](./slack.md).

Gmail is an `http` target at origin `https://gmail.googleapis.com`, credentialed by an OAuth refresh
token injected as a header. It is kept for three things: the two-policies-over-one-recipe story
(DG2) told over an `http` recipe rather than a `cli` one, and the two findings below — that a send
verb is unwrappable here by design, and that an OAuth scope and a policy constrain overlapping
things and can contradict.

`http` is the right kind here rather than a shortcut. Gmail publishes no packaged, non-interactive,
argv-driven binary this project is willing to install on the credentialed host, which is the test
the spec's kind-choosing rule sets; where such a binary exists, `cli` wins, and
[github](./github.md) is that case. The price is stated where it lands: an `http` recipe has no
surface map, every record it produces carries `surfaceDigest: null`, `doctor` has nothing to re-run,
and G14 does not hold — a provider that moves this grammar is undetected here.

## The recipe

One recipe, four verbs: two `read`, two `remote-write`. Annotations are `//` comments for
readability; the artifact would be JSON.

```jsonc
{
  "$schema": "../schemas/recipe.json",
  "name": "gmail",
  "kind": "http",

  "target": {
    "origin": "https://gmail.googleapis.com", // parsed once at check time into three constants
    "pathPrefix": ["gmail", "v1", "users", "me"], // `me` is a literal: one wrap, one mailbox
  },

  "credential": {
    "kind": "oauth-refresh",
    "refresh": {
      "origin": "https://oauth2.googleapis.com", // a second origin, subject to every rule in R1–R14
      "path": ["token"],
      "grant": "refresh_token",
    },
    "inject": { "via": "header", "header": "authorization", "prefix": "Bearer " },
  },

  "configRoot": null, // check fails a non-null configRoot on an http recipe
  "surface": null, // http recipes have no surface map
  "opaqueMediaType": null,
  "neverModel": [],
  "concurrency": { "key": "credential", "max": 2, "queueMaxMs": 2000 },
  "limits": { "requestBodyMaxBytes": 16384, "responseMaxBytes": 1048576, "executionMs": 15000 },

  "verbs": [
    {
      "match": ["messages", "list"],
      "effect": "read",
      "evidence": "developers.google.com/gmail/api/reference/rest/v1/users.messages/list — returns message ids and thread ids; changes no mailbox state",
      "request": {
        "method": "GET",
        "path": ["messages"],
        "query": {
          "q": { "arg": "query" },
          "maxResults": { "arg": "limit" },
          "labelIds": { "arg": "label" },
        },
        "headers": { "accept": "application/json" },
        "body": { "kind": "none" },
      },
      "args": {
        "query": { "type": "string", "pattern": "^[A-Za-z0-9 :._@/-]{1,200}$", "optional": true },
        "limit": { "type": "int", "min": 1, "max": 100, "default": 25 },
        "label": {
          "type": "enum",
          "values": ["INBOX", "UNREAD", "Label_ai-triage"],
          "repeated": true,
          "optional": true,
        },
      },
    },

    {
      "match": ["messages", "get"],
      "effect": "read",
      "evidence": "developers.google.com/gmail/api/reference/rest/v1/users.messages/get — read-only; format=metadata returns headers and a snippet, not the body",
      "request": {
        "method": "GET",
        "path": ["messages", { "arg": "messageId" }], // one whole segment, never a fragment of one
        "query": { "format": { "fixed": "metadata" } },
        "headers": { "accept": "application/json" },
        "body": { "kind": "none" },
      },
      "args": { "messageId": { "type": "string", "pattern": "^[0-9a-f]{16}$" } },
    },

    {
      "match": ["messages", "label"],
      "effect": "remote-write",
      "evidence": "developers.google.com/gmail/api/reference/rest/v1/users.messages/modify — adds and removes label ids; reversible by the inverse modify, which this recipe models",
      "destination": ["addLabel", "removeLabel"],
      "request": {
        "method": "POST",
        "path": ["messages", { "arg": "messageId" }, "modify"],
        "query": {},
        "headers": {}, // content-type is derived from body.kind and is not settable
        "body": {
          "kind": "json",
          "fields": {
            "addLabelIds": { "arg": "addLabel" }, // a repeated arg emits an array of scalars
            "removeLabelIds": { "arg": "removeLabel" },
          },
        },
      },
      "args": {
        "messageId": { "type": "string", "pattern": "^[0-9a-f]{16}$" },
        "addLabel": {
          "type": "enum",
          "values": ["Label_ai-triage", "Label_ai-answered"],
          "repeated": true,
          "optional": true,
        },
        "removeLabel": {
          "type": "enum",
          "values": ["UNREAD"],
          "repeated": true,
          "optional": true,
        },
      },
    },

    {
      "match": ["messages", "trash"],
      "effect": "remote-write",
      "evidence": "developers.google.com/gmail/api/reference/rest/v1/users.messages/trash — moves the message to TRASH; reversible by untrash, which this recipe does not model",
      "destination": ["messageId"],
      "request": {
        "method": "POST",
        "path": ["messages", { "arg": "messageId" }, "trash"],
        "query": {},
        "headers": {},
        "body": { "kind": "none" },
      },
      "args": { "messageId": { "type": "string", "pattern": "^[0-9a-f]{16}$" } },
    },
  ],
}
```

`messages trash` is inventory, and stays inventory. Its destination argument is a provider-side
opaque identifier an agent discovers by reading, and no member of the closed predicate set
enumerates one — `argEquals` and `argIn` want a set an author can write down, and `argDomainIn` is
`email`-typed. So no policy over this recipe can permit `trash` without leaving a destination
argument unconstrained, which `check` fails as `destination-unconstrained`. That is the third branch
of the spec's own prescription when the closed set lacks what a policy needs: express a bounded
approximation, route the residue to `ask` inside an already-bounded destination, or refuse and
record the gap. This records the gap. A partial grammar is sound, so the verb stays in the recipe as
what is _possible_ and appears in neither policy.

`messages label` avoids the same problem by naming the labels as its destination rather than the
message: which labels move is enumerable, which message they move on is not, and the honest reading
of that recipe is "this wrap can put one of two agent-owned labels on any message in the mailbox its
credential already reads".

## Two policies, one recipe

The recipe is untouched by the second policy. New: one policy file, one wrap file, one trials file —
the increment AC-5.1 fixes and AC-5.5's T4 measures, though both are measured against the shipped
examples, not here.

```jsonc
{
  "$schema": "../schemas/policy.json",
  "name": "gmail-readonly",
  "recipe": "gmail",
  "intent": "Summarise a mailbox for a daily digest. Nothing in the mailbox changes.",
  "default": "deny",
  "budget": { "perHour": 240, "perVerb": { "messages list": 60, "messages get": 240 } },
  "rules": [
    {
      "id": "read-anything",
      "when": { "effectIn": ["read"] },
      "action": "allow",
      "why": "Reading a mailbox this wrap already holds a read-scoped credential for costs nothing that has to be undone.",
    },
  ],
}
```

```jsonc
{
  "$schema": "../schemas/policy.json",
  "name": "gmail-triage-labeler",
  "recipe": "gmail",
  "intent": "Move triaged mail into one agent-owned label and clear UNREAD. It labels; it never deletes.",
  "default": "deny",
  "budget": { "perHour": 300, "perVerb": { "messages label": 120 } },
  "rules": [
    {
      "id": "read-anything",
      "when": { "effectIn": ["read"] },
      "action": "allow",
      "why": "Labelling is only useful after reading, and reading changes nothing.",
    },
    {
      "id": "label-into-triage",
      "when": {
        "verb": "messages label",
        "argIn": { "addLabel": ["Label_ai-triage"], "removeLabel": ["UNREAD"] },
        "argCountAtMost": { "addLabel": 1, "removeLabel": 1 },
      },
      "action": "allow",
      "why": "One agent-owned label and the UNREAD flag are the only mailbox state this application may move, and a person undoes either in one click.",
    },
  ],
}
```

`argIn` is universally quantified, so `label-into-triage` holds only if _every_ value of `addLabel`
and _every_ value of `removeLabel` is in its set — which is what makes an allowlist over a repeated
argument mean what it reads like. Everything the two rules do not name, `messages trash` included,
falls to the `deny` default and exits 77 with the canonical denial block.

## Finding: a send verb is unwrappable here, and that is the design working

Gmail's `users.messages.send` takes one field, `raw`: a base64url-encoded RFC 2822 message. The
recipients are not parameters of the request. They are header lines — `To:`, `Cc:`, `Bcc:` — inside
that blob.

Both ways of expressing it fail, and they fail in the schema rather than at review:

- As a `json` body field bound to a `text` argument, the recipients are bytes inside one value. The
  verb's effect is `irreversible-outward`, so `destination` is required, and there is no argument to
  name in it: `messageId` does not exist yet and `raw` is the whole message.
- As an `opaque` body — the envelope's stdin bytes or one staged `workspace-path` input — the bytes
  are capped, digested before the verdict, never parsed, and **never a value named in
  `destination`**. Naming `raw` anyway fails `check`, because a destination argument must occupy a
  policy-visible rendering position and an opaque body is not one.

The reason this is a property and not an oversight is one line long: **a CRLF in a composed header
defeats every recipient allowlist.** An `argDomainIn` rule over a typed `to` argument is a real
bound — it matches the validated domain part of a strict single addr-spec, and the type refuses a
comma, angle brackets, a display name, whitespace and control bytes before policy ever sees the
value. A composed blob has none of that shape. One `\r\nBcc: elsewhere@example.net` inside the
composed headers sends the same message to an address no rule evaluated, while every rule that did
run still says allow. Closing that would mean parsing the blob to extract its recipients — which
makes the parser the trust boundary, and makes agent-cli the author of a message it did not
compose. The spec settles both: composing messages on behalf of a target is a non-goal (not ever),
and parsing what a request or a response carries is out by Scoping guidance.

The boundary this draws is not "mail is special". It is **the destination must be a typed argument
the policy can see**. Slack's `chat post` is wrappable for exactly that reason — its `channel` is an
`enum` in a scalar JSON body value, `destination: ["channel"]` names it, and `argIn` bounds it. A
provider that takes recipients as typed scalars is wrappable; a provider that takes a composed
document is not, whichever rendering it speaks. [mail](./mail.md) is the same finding without an
HTTP origin attached.

## Finding: an OAuth scope and a policy constrain overlapping things

A scope and a policy are both bounds on what a credential can be made to do, and they are shaped
differently. A scope is provider-side, coarse and mailbox-wide: `gmail.readonly` covers a family of
reads over everything the account can see. A policy is program-side and fine: one verb, one
argument value, one destination, one budget, keyed by `(instance, wrap)`.

**Neither wins. The effective permission is the intersection, and each layer stops an invocation in
its own vocabulary** — which is the part worth knowing, because the two are not interchangeable to
the agent that hits them:

| Bound                                          | What the agent sees                                                                                                                                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The policy denies                              | Exit 77, the canonical denial block with verb, effect, reason, remedy and request id. No target is reached, no credential is bound                                                                                         |
| The credential's scope does not cover the verb | The request is issued and the provider refuses it. That is the target's own failure: exit 1 for an `http` target, `outcome: failure`, the provider's error body on stdout, and no agent-cli-authored byte on either stream |

Gmail signals that refusal as an HTTP 403 with a JSON error body, so exit 1 is correct and G5 holds
here as written — a caller distinguishes "policy refused you" from "the tool failed" without parsing
prose. A provider that signals authorization failure as HTTP 200 with a failure in the body degrades
that, which is what Q15 is about; gmail is not that provider, and slack is.

**Where they contradict, `check` catches one direction at authoring time.** `check` fails a policy
whose permitted effects exceed its wrap credential's declared scopes, reason `credential-scope`, so
a labelling policy over a read-scoped token is red before `deploy` rather than a 403 in production.
The gate is coarse on purpose: it compares effect classes against the scopes the credential store
records, not the provider's scope semantics. It catches "a write policy over a read token"; it does
not catch "a `gmail.modify` token under a policy that only labels", and it is not meant to — a
credential wider than its policy is the normal case, because narrowing is the whole job of a policy.

**The credential is scoped per wrap wherever the provider permits it.** A wrap is one recipe, one
policy, one credential, one command name, so `gmail-readonly` holds a `gmail.readonly` token and
`gmail-triage-labeler` holds a `gmail.modify` one. That second, provider-enforced bound is the only
one in this design that does not depend on agent-cli being correct: a widened rule, a wrong effect
class or an unexplained `deny → allow` cannot turn the read wrap into a mailbox-wide writer, because
its token cannot write. Where a provider issues only one indivisible token, the policy is the sole
bound, and `credential.bound` records `{id, version, kind, scopes, boundVia}` on every invocation so
that which scope set decided is reconstructable rather than inferred.

Two consequences of that placement, both deliberate. The credential is named in the **wrap** file,
never in the policy — a per-policy credential override would hide a second enforcement layer inside
the wrong file and make the policy undeployable over a second mailbox. And the scoping itself
happens where the credential is minted, outside this spec: agent-cli reads a credential store and
never issues, rotates or revokes; `deploy` fails naming the id when a credential does not exist, and
`retire` does not revoke a token agent-cli did not issue.

The refresh side is not a lesser path. The refresh rendering is an `http` rendering and every rule
R1–R14 applies to it, so this recipe's credential record lists two origins — the target's and
`https://oauth2.googleapis.com` — `deploy` fails a wrap whose recipe origin is absent from that
list, the auth process refuses to attach the credential anywhere else, and `show --egress` prints
both. That is G17, and the refresh exchange carries the highest-value secret in the system.

## Where the rest of this lives

| Question                                                          | Doc                                                            |
| ----------------------------------------------------------------- | -------------------------------------------------------------- |
| What are all the examples, and which execute?                     | [examples router](./README.md)                                 |
| What does a shipped `http` target look like?                      | [slack](./slack.md)                                            |
| Why is a mail target paper too?                                   | [mail](./mail.md)                                              |
| Why is `cli` preferred where a binary exists?                     | [github](./github.md)                                          |
| What are the rendering rules, guarantees and criteria cited here? | [spec.md](../spec.md)                                          |
| Which milestone builds the one `http` target that ships?          | [M4](../milestones/M4-slack-http-target.md)                    |
| Why is the emitter what it is?                                    | [ADR-0004](../../../adr/0004-typescript-node-for-agent-cli.md) |
