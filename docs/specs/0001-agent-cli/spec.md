# Spec 0001: agent-cli

Status: Draft
Accepted: —
Supersedes: —

## Summary

This builds a toolkit that turns a **recipe**/**policy** pair into a credential-free command an agent
runs inside a sandbox, decided and executed by an **auth process** outside it. It is for the owner of
an agent-village application who needs agents to use real capabilities under different rules per
application, and who will maintain dozens of these while the systems underneath them change. It is
first because [agent-environment and agent-server](../../../README.md) both assume capabilities can be
granted, revoked and reviewed as units, and because this is the smallest component that forces the
repository to choose a stack, turn [ADR-0002](../../adr/0002-history-over-commentary.md) and
[ADR-0003](../../adr/0003-auditability-is-a-requirement.md) into mechanical checks, and fix the shape
of an audit record.

## Design goals

Prefixed `DG`, because `G` is reserved for guarantees. Ranked for **conflict resolution**, not for
value. DG1 is first because [design-principles.md](../../dev/design-principles.md) forbids trading a
trust boundary for simplicity. DG2 is the owner's stated priority. Where they collide, DG1 wins and
the cost is written down as an open question.

| #   | Goal                                                                            | Achieved when                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DG1 | The credential never enters the sandbox, and every use of it is reconstructable | A scan of a running sandbox's mounts, process environments, argv and returned streams finds no credential material and no policy, recipe or surface map; and every invocation that reached a target has a journal record carrying its request, verdict, reason, decider and digests                                                                               |
| DG2 | Authoring and maintaining a wrap is cheap enough that an agent does it          | A second policy over an existing recipe is three files (policy, wrap, trials), one hand-written, with no edit to the recipe or its surface map; adding one verb is one recipe edit plus one trial; and the thresholds in AC-5.5 are met for both target kinds                                                                                                     |
| DG3 | Every promise the toolkit makes turns something red                             | `agent-cli check` exits non-zero on each gate in AC-5.2, and a target whose policy-referenced grammar moved quarantines its wrap at runtime                                                                                                                                                                                                                       |
| DG4 | A denial teaches the agent instead of costing it a turn                         | A denial exits `77` with the fixed block naming verb, effect, reason, remedy and request id; and the same invocation in explain mode returns an identical verdict with no credential bound, no target reached and no approver consulted                                                                                                                           |
| DG5 | The design generalizes past its first target                                    | A fifth target ships two policies with no change to the policy schema or the wire contract, and a recipe-schema change only if it speaks a protocol neither rendering covers                                                                                                                                                                                      |
| DG6 | Policy edits cannot outrun their gates                                          | A verdict whose `policyDigest` is absent from the deployed set does not exist in the journal, and editing a policy file produces no behaviour change until `deploy` succeeds                                                                                                                                                                                      |
| DG7 | The system stays small enough to hold in one head                               | The shipped package declares one runtime dependency (or two, if Q2 admits the reserved native slot — the allowance AC-7.4 gates on), argued in [ADR-0006](../../adr/0006-typescript-node-for-agent-cli.md); the toolkit has exactly the fifteen commands listed in Architecture; and on-disk artifacts are covered by `pnpm check` the day the first recipe lands |

## Terminology

**Binding on acceptance** — the code uses these words for these things and no others.

| Term                     | Means                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sandbox**              | The confined execution context an agent runs in. Of this system it holds only its shims and its grant directory.                                                                                                                                                                                                                                                                               |
| **Agent**                | Whatever runs inside the sandbox and invokes commands. Everything it produces is untrusted.                                                                                                                                                                                                                                                                                                    |
| **Application instance** | One running deployment of an agent-village application. The scope of budgets and of journal reads.                                                                                                                                                                                                                                                                                             |
| **Session**              | The lifetime of one sandbox within an application instance. Named by the grant directory it is given.                                                                                                                                                                                                                                                                                          |
| **Target**               | The real, third-party system holding the capability, of one of two kinds: a `cli` target, a binary the auth process spawns, or an `http` target, an API the auth process calls at a recipe-fixed origin. Reached only from outside the sandbox, only with a credential, only as the auth process renders and issues.                                                                           |
| **Recipe**               | The description of how to speak to one target: its kind and that kind's fixed rendering constants, credential kind and injection point, verbs, argument types, effects, forbidden tokens, redaction, limits. Says what is _possible_, never what is permitted.                                                                                                                                 |
| **Rendering**            | The projection of one request into the concrete form its target accepts: for a `cli` target, argv plus the constructed environment, cwd and stdin; for an `http` target, method, request-target, headers and body. Built only by substituting typed values into positions the recipe enumerates, never by concatenating into structure. Exactly two renderings exist; `check` refuses a third. |
| **Origin**               | Scheme, host and port, in the RFC 6454 sense, fixed by an `http` recipe as three separate constants. No argument type can bind into it, no verb can override it, and no response can name one.                                                                                                                                                                                                 |
| **Surface map**          | The captured inventory of one `cli` target's command surface at one observed version, with a digest. A re-checkable claim about the world, not an authored artifact. An `http` recipe has no surface map, and every record it produces carries `surfaceDigest: null`, which means: this recipe makes no checkable claim about its target's surface.                                            |
| **Verb**                 | A named point in a target's surface a recipe recognizes, with its arguments and their types. The vocabulary policies are written in.                                                                                                                                                                                                                                                           |
| **Effect class**         | A recipe's declaration of one verb's blast radius: `read`, `local-write`, `remote-write`, `irreversible-outward`. Ordered by how hard the consequence is to undo.                                                                                                                                                                                                                              |
| **Destination**          | The recipe-declared list of arguments that determine where a `remote-write` or `irreversible-outward` verb's effect lands. Required on every such verb. A destination argument must occupy a policy-visible rendering position — an argv token, a URL segment, a query value, or a scalar JSON body value. It may never be an opaque body, and may never derive from a `workspace-path`.       |
| **Policy**               | An ordered set of rules with an explicit `deny` default, an `intent`, and a `why` on every rule. Says what is _permitted_, nothing about how to invoke anything. Many policies exist over one recipe.                                                                                                                                                                                          |
| **Rule**                 | One element of a policy: a condition, an action (`allow`, `deny`, `ask`), and a `why` giving the reason a person would give.                                                                                                                                                                                                                                                                   |
| **Predicate**            | One condition available to a rule, from the closed set fixed by this spec. Policies contain no expressions and no code.                                                                                                                                                                                                                                                                        |
| **Wrap**                 | One recipe, one policy, one credential, one command name, granted to one or more sessions. The unit deployed, granted, invoked, audited, revoked and retired.                                                                                                                                                                                                                                  |
| **Command**              | The name a wrap takes inside the sandbox. Two wraps in one grant directory never share one.                                                                                                                                                                                                                                                                                                    |
| **Grant directory**      | `grants/<app>/<instance>/<session>/`, bind-mounted into exactly one sandbox. Its contents are that sandbox's complete capability set.                                                                                                                                                                                                                                                          |
| **Shim**                 | The credential-free executable inside the sandbox bearing a wrap's command name, generated by `deploy`, holding one constant: its socket path.                                                                                                                                                                                                                                                 |
| **Auth process**         | The process outside the sandbox that holds credentials, turns envelopes into requests, decides, reaches targets, and records. The only credentialed component in this spec.                                                                                                                                                                                                                    |
| **Principal**            | Who an invocation is on behalf of: `{app, instance, session, wrap}`, derived from the accepting socket's path, never from anything the sandbox asserts.                                                                                                                                                                                                                                        |
| **Envelope**             | The wire form of one attempted invocation. Untrusted in full, in every field.                                                                                                                                                                                                                                                                                                                  |
| **Request**              | The typed, normalized form of one invocation. The only thing a policy or approver sees, and the only source of the rendering a target receives.                                                                                                                                                                                                                                                |
| **Total match**          | The invariant that a request accounts for every token of the envelope's argv. Any unconsumed token converts the invocation into a denial naming that token.                                                                                                                                                                                                                                    |
| **Workspace**            | The one directory tree mounted at the identical absolute path on both sides. The only namespace in which an argument may name a file.                                                                                                                                                                                                                                                          |
| **Staging directory**    | The per-request directory a `cli` target runs in, holding content-addressed copies of its inputs and the destinations for its declared outputs. Private to the auth process.                                                                                                                                                                                                                   |
| **Config root**          | The recipe-owned directory outside the workspace that `HOME` and every `XDG_*` variable point at, so target configuration is unreachable from the sandbox. A `cli`-only property; `check` fails a non-null `configRoot` on an `http` recipe.                                                                                                                                                   |
| **Execution**            | One issuance of an allowed rendering to its target: a spawned process group for `cli`, one HTTPS request/response exchange for `http`.                                                                                                                                                                                                                                                         |
| **Verdict**              | The decision on one request: `allow` or `deny`, with a reason code, one human sentence, the decider, the matched rule, and the digests that produced it. There is no third decision.                                                                                                                                                                                                           |
| **Reason code**          | The machine-readable member of a closed set saying why a verdict went as it did. A different closed set from audit event names.                                                                                                                                                                                                                                                                |
| **Decider**              | Which authority produced a verdict: `policy`, `approver`, or `runtime`. Exactly these three values, everywhere.                                                                                                                                                                                                                                                                                |
| **Approver**             | The model consulted where a rule's action is `ask`. Can narrow a decision the policy already reached; can never widen one.                                                                                                                                                                                                                                                                     |
| **Brief**                | The material an approver is shown: verb, effect, the policy's `intent`, the rule's question, and only the argument values the rule marked showable. Contains no free-form string authored by any principal other than the policy author.                                                                                                                                                       |
| **Remedy**               | The sentence attached to a denial saying what would work instead, written to be acted on by an agent.                                                                                                                                                                                                                                                                                          |
| **Trial**                | A stored invocation paired with the verdict, rule and reason it must receive. The unit of policy testing. Runs offline; never calls a model.                                                                                                                                                                                                                                                   |
| **Deployed set**         | The digest-pinned collection of recipes, policies, wraps, grants and quarantine flags the auth process is serving. The only configuration with runtime effect.                                                                                                                                                                                                                                 |
| **Deploy**               | The single operation moving authored artifacts into the deployed set, having first run every gate.                                                                                                                                                                                                                                                                                             |
| **Quarantine**           | The state of a wrap whose recipe no longer matches its installed target. Every invocation denies until an author re-locks and redeploys.                                                                                                                                                                                                                                                       |
| **Drift**                | A difference between a recorded surface map and the installed target.                                                                                                                                                                                                                                                                                                                          |
| **Credential**           | The material a target needs to act. Referred to everywhere by `{id, version}`; the material exists only in the credential store and in a reached target's environment, private file, or injected header.                                                                                                                                                                                       |
| **Budget**               | A policy-declared bound on invocations per hour, overall and per verb, keyed by `(instance, wrap)`.                                                                                                                                                                                                                                                                                            |
| **Journal**              | The append-only record of what this system decided and did. Contents fixed by the Audit surface section.                                                                                                                                                                                                                                                                                       |
| **Toolkit**              | The `agent-cli` command, outside the sandbox, that creates, checks, tests, simulates, reviews, deploys, revokes, retires, diagnoses and observes wraps.                                                                                                                                                                                                                                        |
| **Explain mode**         | Running the decision path with execution disabled and the approver never consulted. Reachable by an author (`simulate`) and by the agent (`mode: "explain"`).                                                                                                                                                                                                                                  |

**Words this spec does not use**, because each is a second name for something above: _operation_ (say
verb), _wrapped CLI_ (say wrap), _canonical request_ (say request), _surface lock_ (say surface map),
_control frame_ (say envelope), _transport_ for a rendering (transport is the shim-to-auth-process
wire), _endpoint_, _call_, _client_ or _API_ as nouns for a verb or a target, _review_ as a verdict,
and _refuse_/_reject_ as outcomes distinct from denial — every stop is a **denial** with a reason
code, so there is one failure vocabulary. **URL path** is not used either: say **request-target** for
the wire form and **segment** for one of its components, so that _path_ keeps meaning a workspace
path everywhere (`workspace-path`, `pathUnder`, `path.staged`, `path-escape`).

## User flows

Three actors, defined once: the **agent** runs wrapped commands and never sees a recipe, policy or
credential; the **author** is usually an agent in this repository, and writes and maintains
artifacts; the **operator** is the owner, and grants, revokes and reads the journal.

### Flow 1 — an agent invokes a wrapped command and it is allowed

**Trigger:** the agent runs `gh issue list --repo agent-village/agent-village --limit 20`.

The shim connects to its compiled-in socket path and sends one envelope frame
`{v:1, mode:"execute", argv[], cwd, stdinBytes:0}` followed by exactly that many stdin bytes. The
auth process resolves the accepting socket path to `(app, instance, session, wrap)` and thence to
`(recipe, policy, credential)`, mints a `requestId`, and emits `invocation.received`. It normalizes
argv against the verb grammar under total match; resolves and stages nothing, since this verb has no
path arguments; evaluates rules until one matches; emits `verdict.allowed` **before** any execution;
emits `credential.bound` with `{id, version}`; renders and issues — for `gh`, spawning with an
environment constructed wholly from the recipe and cwd set to the staging directory — and streams
stdout and stderr on separate frames. It emits `execution.completed` with exit code, byte counts and
digests.

**The agent sees** ordinary `gh` output on the ordinary streams, and exit 0.

**How it ends badly.**

| Case                                       | Behaviour                                                                                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| The target itself fails                    | Its own stderr and exit code pass through, `outcome: failure`. Distinguishable from a denial, which is always 77.                 |
| Execution timeout                          | SIGTERM, then grace, then SIGKILL on the process group. Exit 124, `execution.timeout`.                                            |
| Output cap                                 | The stream stops, the completion frame states truncation, exit 125.                                                               |
| The agent interrupts, or the shim dies     | Connection close is a cancel: the process group is killed, `execution.cancelled`, `outcome: unknown` if the verb is irreversible. |
| Credential concurrency slot busy           | Waits `queueMaxMs`, then denies `busy`, exit 76.                                                                                  |
| The target writes outside declared outputs | Those writes live in staging and are discarded with it.                                                                           |

### Flow 2 — an agent invokes a wrapped command and it is denied

**Trigger, unmodeled invocation:** `gh pr merge 412 --squash`. Normalization finds no matching verb,
emits `request.unmapped`, then `verdict.denied` with reason `unmapped-verb`. The agent gets the
canonical block on stderr and exit 77. **This is the one canonical denial block; every other section
of this spec cites it rather than restating it.**

```
agent-cli: denied
  wrap:    github-readonly     command: gh
  policy:  github-readonly@sha256:4c1e…
  verb:    (none matched)      effect: —
  reason:  unmapped-verb
  detail:  no verb matches `pr merge`; token `--squash` was not consumed
  remedy:  this wrap models 3 of gh's commands. Ask the owner to add `pr merge`, quoting the request id.
  request: req_01J8YB7C4M      (AGENT_CLI_MODE=explain retests without executing)
```

**Trigger, explain first:** the agent sets `AGENT_CLI_MODE=explain` and reruns. The shim sends
`mode: "explain"`. The whole decision path runs with execution disabled, no credential bound, no
target reached, and **the approver never consulted** — a matched `ask` rule returns `would: ask` with
its rule id. Explain carries its own budget an order of magnitude below the wrap's, and its response
is a strict subset of the denial block: verdict, reason code, detail, rule id, remedy, `requestId`.
No credential id, no version, no absolute path, no environment. Emits `explain.answered`.

**How it ends badly.**

| Case                                        | Behaviour                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| The agent retries the same thing            | Denied identically, each attempt recorded. This is `observe`'s raw material.                                                    |
| Budget exhausted                            | `budget.exhausted`; the remedy carries the window reset time.                                                                   |
| Path outside the workspace                  | Denied before policy, reason `path-escape`, naming the parameter and **not** the resolved path.                                 |
| The wrap is quarantined                     | `recipe-drift`; the remedy says plainly that this is not the agent's error.                                                     |
| The agent enumerates the policy via explain | Permitted and intended. The policy is not the secret; the credential is. Explain is separately budgeted so it is not an oracle. |

### Flow 3 — an author wraps a target nobody has wrapped before

**Trigger:** an application needs a capability no wrap provides.

```bash
agent-cli new recipe github --kind cli --exec gh --introspect help-walk --depth 2
agent-cli new policy github-readonly --recipe github --from read-only
agent-cli new wrap github-readonly --policy github-readonly --credential gh-ro --command gh --grants inbox-digest
agent-cli check && agent-cli test --update && agent-cli deploy
```

Introspection reports how many help pages it walked, writes a surface map with a digest, and writes a
recipe skeleton in which **every effect is `unclassified`**. The author keeps three verbs and leaves
the rest as inventory — partial grammars are sound, so the surface map is inventory, not a to-do
list. The first `check` fails naming the file, the field, and the command that fixes it. The
load-bearing fields the author must set are `configRoot`, `neverModel`, `concurrency.key`, and
`destination` on any `remote-write` or `irreversible-outward` verb.

For an `http` target there is no help tree to walk: `new recipe --kind http` writes an empty skeleton
and the author writes the first verb from the provider's documentation, including its required
`evidence` string. **Prefer `cli` whenever a packaged, non-interactive, argv-driven binary exists**;
`http` is the fallback kind, not the modern one, because `cli` gets a scaffolder and a re-runnable
local artifact for drift and `http` gets neither.

**How it ends badly.**

| Case                                   | Behaviour                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No walkable help tree                  | `help-walk` reports what it could not read and writes an **empty** skeleton rather than a plausible-but-wrong grammar. This is the spec's largest open risk. |
| Wrong effect classification            | Nothing catches it. `check` enforces that an effect is _stated_, not that it is true.                                                                        |
| A gate fails at deploy                 | Nothing materializes. There is no partial deploy.                                                                                                            |
| The credential does not exist          | Deploy fails naming the id. agent-cli reads a credential store; it never creates one.                                                                        |
| The author edits a policy and restarts | No effect. The fix is `deploy`, and the error says so.                                                                                                       |

### Flow 4 — an author adds a second policy over an already-wrapped target

**Trigger:** `github-readonly` exists; a second application needs read plus comment. This is the DG2
flow, and the whole recipe/policy split exists for it.

**Reused unmodified:** the recipe, the surface map, every verb and effect, redaction, `neverModel`,
the concurrency key, the shim generator, the wire contract, the trials harness, the journal pipeline.
**New:** three files — policy, wrap, trials — one of them hand-written. `agent-cli diff` reports the
change as verbs moved between verdicts, plus argument bounds, plus the credential change, plus an
explicit `widening: yes`. CI rule: `diff --against HEAD` exits non-zero when a verb moves
`deny → allow` with no changed `why`.

**How it ends badly.**

| Case                                                       | Behaviour                                                                                                                                                  |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command-name collision in one grant directory              | Refused — it is a filesystem fact, not a policy question.                                                                                                  |
| A send policy points at a read-scoped credential           | `check` fails `credential-scope`.                                                                                                                          |
| A destination argument left unconstrained on an `ask` rule | `check` fails `destination-unconstrained`.                                                                                                                 |
| The policy needs a predicate the closed set lacks          | There is no escape hatch. Express a bounded approximation, route the residue to `ask` inside an already-bounded destination, or refuse and record the gap. |

### Flow 5 — an author tests and simulates before shipping

`agent-cli simulate` prints the typed request, each rule and why it did or did not match, the exact
brief an `ask` would produce, and the exact rendering — for `cli`, argv, cwd and environment key
count; for `http`, method, origin, request-target with `redact` values applied, header **names** only,
body digest and byte count — with the credential **not** bound. It executes nothing.

`agent-cli test` replays trials offline against a fixed clock and never calls a model. An `ask` trial
asserts the **routing** — which rule matched and that its action is `ask` — not the model's answer.
That is what makes the suite deterministic with no pinning machinery at all. `test --update` rewrites
observed verdicts and reasons so a policy edit reaches review as a diff of behaviour.
`trial add --from req_…` turns a real denial into a failing test.

**How it ends badly.**

| Case                                         | Behaviour                                                                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| A trial moved unintentionally                | The failure names the rule whose edit moved it and the case that moved.                                                             |
| The author expects a rehearsed send          | `simulate` proves a verdict, never an effect. There is no dry run of an SMTP conversation or a Slack post, and the toolkit says so. |
| Every trial passes but the wrap fails in use | Trials prove policy. Credential scope, quarantine and concurrency are `check` and `doctor` concerns, and `deploy` runs all three.   |

### Flow 6 — an operator reviews what happened

`agent-cli journal --session ses_…` reconstructs one session in order.
`agent-cli journal --request req_…` resolves one decision to the exact policy text via its digest,
labels a retired digest as retired, and prints the exclusion list so absence is legible.

**How it ends badly.**

| Case                                  | Behaviour                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| The range is past retention           | Returns `pruned` with the dropped range and the `audit.pruned` record — never "not found".             |
| The policy has since been redeployed  | Renders the **old** digest, labelled. Never the current text, which would be a lie about what decided. |
| The digest is unresolvable            | Says so. An honest gap beats a plausible reconstruction.                                               |
| An irreversible invocation was killed | `outcome: unknown`. The next place to look is the provider's own record.                               |
| The operator wants the message body   | Not there, and never was. Only a digest and a byte count.                                              |

### Flow 7 — maintenance: a wrapping has rotted

**Branch A, the target changed.** `agent-cli doctor` re-introspects a `cli` target and diffs against
its surface map. An additive change is informational. A grammar change to a **policy-referenced** verb
**quarantines** the wrap: `wrap.quarantined`, and runtime denials with `recipe-drift` until repair.
Repair is `new recipe … --relock`, `diff --recipe`, `test`, `deploy`. **An `http` target has no
surface to monitor**, so `doctor` has nothing to re-run and the quarantine mechanism never fires for
it; this is stated as an unguarantee rather than hidden.

**Branch B, the policy rotted.** `agent-cli observe --since 7d` reads the journal, groups denials as
candidate widenings **and** reports permitted-but-never-invoked rules as candidate narrowings, writes
a patch file, and applies nothing.

**How it ends badly.**

| Case                                              | Behaviour                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `doctor` cannot run the target                    | `surface-unverifiable` — blocking in CI, **not** quarantining, because inability to introspect is not evidence of change. |
| One upstream release quarantines several apps     | Deliberate. The pressure valve is the recipe's pinned `target.version` on the auth host; a break-glass is Q8.             |
| A flag keeps its name and changes meaning         | Nothing detects it. The only defences are trials and the effect classification — stated, not implied away.                |
| An author applies `observe`'s proposals wholesale | Allowed, but `diff` flags the widening and CI fails an unexplained `deny → allow`.                                        |

### Flow 8 — revoking and retiring

`agent-cli revoke --session … --wrap …` deletes a socket: seconds, operator-only, no repository
change. The next invocation exits **127** (`not-granted`), because there is no longer anything there
to decide. `--kill` terminates in-flight process groups and records `outcome: unknown` for
irreversible verbs.

`agent-cli retire --wrap … --reason "…"` is permanent and _is_ a repository change: it marks the wrap
retired, removes the command and socket at the next deploy, moves the policy digest to the retired
digest store so old records stay explicable, and keeps the trials.

**How it ends badly.**

| Case                                    | Behaviour                                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| An author deletes a policy file instead | `check` fails. Half-retirement is not expressible.                                                                      |
| Revoke mid-session                      | The current invocation completes; the next exits 127.                                                                   |
| The last wrap over a recipe is retired  | The recipe stays. `doctor` reports it unused. Nothing auto-deletes, because that would orphan digests old records cite. |
| The credential outlives the wrap        | Retire does not revoke it. agent-cli never had authority to revoke a token it did not issue, and says so.               |

## Architecture

### Invariants

1. **Identity is the socket path, not the message.**
2. **The rendering is constructed on this side.** No byte of the envelope reaches a target unread.
3. **Only the deployed set decides.**

```
sandbox (no credential)              |  auth-process host (credentialed)
  agent                              |
   └ `gh` (generated shim) ──────────┼─▶ grants/<app>/<instance>/<session>/gh.sock
                                     |        │
                                     |        ▼
                                     |   auth process ─▶ approver     (one POST, redacted brief)
                                     |        │        ─▶ cli target  (credential, cwd = staging)
                                     |        │        ─▶ http target (credential, fixed origin)
                                     |        └────────▶ journal      (append-only, outside workspace)
  /workspace ════════════════════════╪══ /workspace  (identical absolute path)
```

### Components

Each carries the three things [design-principles.md](../../dev/design-principles.md) requires of a
modular component: a contract, a trust boundary, and an audit surface.

**Shim.** _Contract:_ connect to one compiled-in socket path; send one envelope frame and exactly
`stdinBytes` bytes; relay frames to the real streams; exit with the completion frame's code.
_Trust boundary:_ it is the dumbest thing in the system and is inside the blast radius. It validates
nothing semantic and enforces exactly two transport bounds (frame size, `stdinBytes` agreement). It
never reads `basename(argv[0])`. _Audit surface:_ none — it emits no records, because a record from
inside the sandbox would be a record the sandbox could forge.

**Grant directory.** _Contract:_ the filesystem topology **is** the capability set. _Trust boundary:_
permissions are the ACL — the sandbox may `connect`, and may not create, rename or unlink.
_Audit surface:_ `wrap.deployed`, `wrap.revoked`.

**Auth process.** _Contract:_ an eight-step pipeline — accept, read envelope, normalize, resolve and
stage, decide, record verdict, execute, complete. _Trust boundary:_ everything from the socket is
untrusted in every field; the envelope schema rejects unknown keys and has no identity field.
_Audit surface:_ every `R`-envelope event below. It has exactly three replaceable seams and no
others: transport, decider, journal sink.

**Workspace and staging boundary.** _Contract:_ an argument typed `workspace-path` names a file
beneath the workspace root and nowhere else. _Trust boundary:_ resolution refuses every symlink at
every component and every escape; inputs are copied into a fresh staging directory and digested
**before** policy evaluates, so the bytes the policy inspected are the bytes the target reads.
_Audit surface:_ `path.staged`, `path.rejected`, `output.rejected`.

**Policy engine.** _Contract:_ ordered rules, first match wins, explicit `deny` default.
_Trust boundary:_ it sees only the typed request, never the envelope. _Audit surface:_
`verdict.allowed`, `verdict.denied`, `budget.exhausted`.

**Approver boundary.** _Contract:_ reachable only from a matched `ask` rule; the result is
intersected with the program's decision. _Trust boundary:_ the brief is built from the typed request
and contains no free-form string authored by anyone but the policy author. _Audit surface:_
`approver.consulted`, `approver.failed`.

**Executor and target boundary.** _Contract:_ issue exactly the rendering the verdict covered.
_Trust boundary:_ no shell anywhere; the child environment is constructed wholly from the recipe; for
`http`, the origin is a recipe constant and no response can name one. _Audit surface:_
`credential.bound`, `execution.*`, `output.truncated`.

**Deployed set.** _Contract:_ digest-pinned; the only configuration with runtime effect.
_Trust boundary:_ writable only by the auth process's owner; `deploy` is the sole path in.
_Audit surface:_ `recipe.changed`, `policy.changed`, `wrap.deployed`, `wrap.quarantined`.

**Toolkit.** Exactly **fifteen commands**: `new recipe`, `new policy`, `new wrap`, `check`,
`test [--update]`, `trial add --from`, `simulate`, `show`, `diff`, `deploy`, `revoke`, `retire`,
`doctor`, `observe`, `journal`. A command not on this list is out of scope for this spec.

**Artifact and credential stores.** Artifacts are JSON with `$schema`, in the repository:
`recipes/<r>.recipe.json`, `recipes/<r>.surface.json` (`cli` only), `policies/<p>.policy.json`,
`wraps/<w>.wrap.json`, `trials/<p>.trials.json`. The credential store is read, never written:
agent-cli refers to credentials by `{id, version}` and never issues, rotates or revokes one.

### Policy: the closed predicate set

Repeated-argument predicates are **universally quantified** — `argIn` holds only if _every_ value is
in the set.

| Predicate          | Shape              | Notes                                                                                           |
| ------------------ | ------------------ | ----------------------------------------------------------------------------------------------- |
| `verb`             | string             | Exact verb name                                                                                 |
| `verbIn`           | string[]           |                                                                                                 |
| `effectIn`         | effect[]           |                                                                                                 |
| `argEquals`        | `{arg: value}`     | Destination-qualifying                                                                          |
| `argIn`            | `{arg: value[]}`   | Destination-qualifying; every value must be in the set                                          |
| `argDomainIn`      | `{arg: domain[]}`  | `email`-typed arguments only; matches the validated domain part exactly. Destination-qualifying |
| `argGlob`          | `{arg: pattern}`   | Anchored whole-value match; `*` crosses neither `@` nor `/`; case-sensitive                     |
| `argAnyGlob`       | `{arg: pattern[]}` | True if any pattern matches                                                                     |
| `argCountAtMost`   | `{arg: n}`         |                                                                                                 |
| `pathUnder`        | `{arg: prefix}`    | Workspace-relative                                                                              |
| `stdinBytesAtMost` | n                  | One shape, scalar                                                                               |

There is no expression language, no plugin, and no callback. Enumerability is what buys the offline
test, the semantic diff, and drift detection; losing it costs all three at once.

### Argument types, closed

`string` (requires a `pattern` or `maxBytes` on any `remote-write` or `irreversible-outward` verb;
refuses a leading `@`), `text`, `int`, `bool`, `enum`, `email` (a strict single addr-spec: no display
name, no angle brackets, no comma, semicolon or whitespace, no quoted local part, no control bytes,
NFC-normalized), and `workspace-path` (with `mode: read | write | create`).

There is no `url` type, no `header` type, and no `method` type. That absence — not a check — is the
mechanism by which most of the attacks in Edge cases are unexpressible.

### Rendering rules — `cli`

argv is rebuilt from the typed request: long flags only, `--flag=value`, recipe order, one `--` before
the first positional, an absent optional argument elides its whole token, a boolean emits only when
true, and a repeated argument expands to one token per value. Plus one `fixedArgs` list of literal
tokens. Nothing is forwarded.

### Rendering rules — `http`

Written to the same tightness as the argv rules, which they do not change. **This is the section that
decides whether the mediation invariant holds for API targets**, so it is normative and lives here
rather than in an example.

**R1 — Connection.** `host` and `port` are constants resolved from `target.origin` at `check` time and
stored in the deployed set as separate fields, passed as separate options to the HTTP client. **No URL
string is parsed at request time and no relative reference is ever resolved.** A lint,
`no-url-parse-on-request-path`, forbids `fetch`, `new URL`, and assignment to `URL.prototype.pathname`
anywhere in the request pipeline. See [ADR-0006](../../adr/0006-typescript-node-for-agent-cli.md) for
why the platform's default HTTP client is disqualified.

**R2 — Request-target.** `segments = target.pathPrefix ++ verb.request.path`. Each element is a recipe
literal string or a `{arg: name}` binding filling exactly one whole segment. The request-target is
`"/" + segments.map(encodeSegment).join("/")`, followed by the query. `encodeSegment` percent-encodes
every byte outside RFC 3986 `unreserved`. It applies **identically to literals and to bound values: a
literal enjoys no privilege a bound value lacks.**

**R3 — Universal segment rejections.** Applied in the type layer — not in an author `pattern` — to
bound values at normalization and to recipe literals at `check` time. A segment value is refused when,
after repeated percent-decoding to a fixed point and ASCII case-folding, it is empty, equals `.` or
`..`, or contains `/`, `\`, `?`, `#`, or any byte below `0x20` or equal to `0x7F`. Reason code
`segment-refused`. **This is a denial, not an unexpressibility**, and it is acceptable precisely
because it is universal, unconditional, and lives where no recipe author can forget it. It is
load-bearing three ways: the HTTP client writes `/api/../x` to the wire verbatim, so the _peer_
resolves dot segments even though the emitter does not; `%2F` also reaches the wire verbatim, and many
gateways and frameworks decode before routing, so a percent-encoded slash re-splits into two
components at the peer and the segment sequence actually reached differs from the template the policy
evaluated; and an empty segment plus a leading `//` is the protocol-relative host swap.

**R4 — Segment binding.** Segment count equals `pathPrefix.length + verb.request.path.length`, is a
recipe constant, and is asserted on the emitted request-target. An argument bound to a segment must be
typed `enum`, `int`, or `string` **with an anchored `pattern`** — a `maxBytes` alone does not qualify.
Segment arguments are always required (optional is not expressible) and repeated arguments are refused
in a segment. The first element of `segments` is never a bound segment.

**R5 — Query.** `verb.request.query` is an ordered map from a recipe-authored key to `{fixed}` or
`{arg}`. Emission follows the argv rules exactly: recipe order; an absent optional argument elides its
whole pair; a `bool` emits only when true, as `key=true`; a repeated argument expands to one
`key=value` pair per value in request order — the one place duplicate keys are legal, so `check`'s
duplicate-key rejection is scoped to recipe-authored keys only. Keys and values are percent-encoded
pair-wise with `&`, `=`, `?`, `#`, `+` and every non-unreserved byte escaped, so a value's bytes can
never become a name or a separator. The query is appended after a single `?`, or omitted when empty.
**No argument may be bound to a key.**

**R6 — Headers.** `headers` is a map from a **lowercased** recipe-authored name to a **recipe literal
string**. There is no binding syntax in a header position at all, which makes CRLF injection
unexpressible by schema rather than excluded by an author's regex. `check` refuses a literal header
value containing any byte below `0x20` or equal to `0x7F`. Names are compared lowercased everywhere.
Emitter-owned names, which a recipe may not declare in any case form: `host`, `content-type`,
`content-length`, `accept-encoding`, `connection`, `transfer-encoding`, and the credential header.
`accept-encoding` is fixed to `identity`. **`content-type` is derived from `body.kind`** — `none`
absent, `json` → `application/json; charset=utf-8`, `opaque` → the recipe's single `opaqueMediaType` —
so a declared media type can never disagree with the serializer that produced the bytes. _Cost,
stated:_ an API needing a caller-supplied opaque header (an idempotency key, a thread token) cannot
have one; move it to a segment or a query value, or the verb is unwrappable in this spec.

**R7 — Credential.** Injection is declared once at recipe level, applies to every verb, is not
omittable or overridable per verb, and is a **set** applied last after every other header.
`credential.bound` records `{id, version, kind, scopes, boundVia}` and never the value. The outgoing
header map is `Redacted<Headers>`, consumable only inside the injector. `boundVia` closes at
`env | file | header`; **`query` is deliberately absent from that enum**, which is what makes "the
credential is never in a request-target" a schema fact rather than a review note.

**R8 — Body.** `body.kind ∈ {none, json, opaque}`. `none` emits no body. `json` is built as an object
from `body.fields`, an ordered map from a recipe-authored key to `{fixed}` or `{arg}`, and serialized
by the platform serializer, so quotes, braces, `&` and control bytes inside a value are escaped and
cannot become structure. An absent optional argument elides its key; a `bool` emits a JSON boolean; a
repeated argument emits a JSON array in request order. **Nesting is one level**: a value is a scalar
or an array of scalars, never an object — structured message payloads are unwrappable, for the same
reason message composition is. `opaque` is the envelope's stdin bytes or one staged `workspace-path`
input, verbatim, capped at `limits.requestBodyMaxBytes`, digested before the verdict, **never parsed,
and never a value named in `destination`**. `check` rejects any `json` body field whose value derives
from a `workspace-path`. Multipart is composition, and stays out.

**R9 — Method.** A recipe constant per verb from `{GET, POST, PUT, PATCH, DELETE}`. There is no method
argument, and a method-override header is unreachable by R6. A `GET` or `DELETE` verb must declare
`body.kind: "none"`.

**R10 — Length.** The total encoded request-target is capped at 2048 bytes; over-cap denies with
reason `request-target-oversize`. Per-argument `maxBytes` does not bound the wire form, because
percent-encoding trebles a value's size.

**R11 — Response.** Redirects are **never followed**: the executor never re-issues, so a 3xx returns
as a non-2xx — because a 3xx is the remote choosing the next host, and origin-fixing would otherwise
be advisory. The exit code is one bit: `0` on 2xx, `1` otherwise; the reserved codes keep their
meanings and `1` collides with nothing. The response body streams to stdout frames verbatim, capped at
`limits.responseMaxBytes` **measured on relayed bytes after decoding**, with `output.truncated` and
exit 125. **stderr is empty and `stderrBytes` is 0** — agent-cli never authors a byte on the target's
channel. Response headers are never read into any typed path and are never recorded. There is no
retry, no `Retry-After`, and no pagination-following: the only rate mechanism is the policy `budget`,
and following a page would be the auth process authoring a request no verdict covered.

**R12 — Ambient state.** The executor constructs an explicit agent: proxy support disabled, no
environment-derived configuration, certificate validation fixed on with no recipe field and a lint
forbidding the identifier that would disable it, and a resolver hook that refuses to connect to a
resolved address in loopback, link-local (including `169.254.169.254`), private or CGNAT ranges —
reason `origin-address-refused`. The auth process refuses to start when the platform's
certificate-validation kill switch is set in its environment. Post-deploy DNS movement is the stated
residual, which is the honest limit without the deferred egress namespace.

**R13 — The other two outbound classes.** The credential-refresh call and the approver call **are
`http` renderings**, and every rule above applies to them without exception: origin validation, the
credential-origin allowlist, redirect refusal, the emitter, the response cap, closed error reason
codes, and inclusion in `show --egress`. The refresh call carries the highest-value secret in the
system.

**R14 — Errors.** Every client error maps to a member of the closed reason-code set: `connect-failed`,
`tls-failed`, `origin-address-refused`, `redirect-refused`, `segment-refused`,
`request-target-oversize`, `response-oversize`. A caught error's message, cause, or serialized form is
never interpolated into an agent-visible frame or an audit field — lint `no-error-passthrough`.

### Choosing a kind

**Prefer `cli` whenever a packaged, non-interactive, argv-driven binary exists; reach for `http` only
when no such binary does.** `cli` gets a scaffolder and a re-runnable local artifact for drift; `http`
gets neither, and G14 does not hold for it. `http` is the fallback kind, not the modern one.

Every `http` verb carries a required non-empty `evidence` string citing the provider documentation its
effect classification rests on, lintable for presence exactly as `why` is. **This makes the
classification reviewable and diffable, not true.** Inferring effect from HTTP method is a seductively
wrong proxy: providers use POST for search, GET for webhook triggers, and PUT for fan-out.

### Wire contract

The envelope is `{v, mode, argv[], cwd, stdinBytes}` followed by exactly `stdinBytes` bytes, read **in
full before normalization**. A short or long read is `malformed-envelope`. No stdin byte reaches a
target before the verdict is recorded. The response is exactly one `Verdict` frame, then interleaved
`Stdout`/`Stderr` frames in arrival order, never merged, then exactly one `Completion` frame.
`Completion.outcome ∈ {success, failure, unknown}` describes **execution only** and is the
authoritative signal. `mode` can only _reduce_ authority.

Exit codes are a convenience whose residual collision risk with a target's own codes is stated and
accepted:

| Code          | Means                                          |
| ------------- | ---------------------------------------------- |
| `77`          | Refused by agent-cli                           |
| `76`          | agent-cli could not decide (retry or escalate) |
| `124`         | Execution timeout                              |
| `125`         | Output cap, or a rejected output               |
| `127`         | Not granted                                    |
| anything else | The target's own code                          |

### Reason codes, closed

Every verdict carries exactly one. Like the audit event names, this set is closed and checked against
the code's const tuple in both directions; a name outside it is a compile error.

| Reason code               | Fires when                                                                        | Exit |
| ------------------------- | --------------------------------------------------------------------------------- | ---- |
| `no-matching-rule`        | No rule matched, so the policy's `deny` default applies                           | 77   |
| `rule-denied`             | A rule matched and its action is `deny`                                           | 77   |
| `approver-denied`         | A matched `ask` rule's approver narrowed the decision to deny                     | 77   |
| `unmapped-verb`           | argv matches no verb, or leaves a residual token                                  | 77   |
| `type-refused`            | An argument value fails its declared type                                         | 77   |
| `segment-refused`         | A URL segment value or literal is refused by R3                                   | 77   |
| `request-target-oversize` | The encoded request-target exceeds R10's cap                                      | 77   |
| `path-escape`             | A `workspace-path` argument names something outside the workspace root            | 77   |
| `budget-exhausted`        | A policy budget bound denies                                                      | 77   |
| `recipe-drift`            | The wrap is quarantined because a policy-referenced verb's grammar moved          | 77   |
| `not-deployed`            | The referenced policy or wrap is absent from the deployed set                     | 77   |
| `malformed-envelope`      | The envelope is unparseable, carries an unknown key, or `stdinBytes` disagrees    | 76   |
| `busy`                    | The credential's concurrency bound held past `queueMaxMs`                         | 76   |
| `decision-timeout`        | The decision deadline expired                                                     | 76   |
| `approver-unavailable`    | The approver was unreachable, timed out, was rate-limited, or answered off-schema | 76   |
| `journal-unavailable`     | The verdict could not be appended, so the invocation is refused rather than run   | 76   |
| `connect-failed`          | The `http` executor could not connect                                             | 76   |
| `tls-failed`              | TLS negotiation or certificate validation failed                                  | 76   |
| `origin-address-refused`  | The origin resolved to a loopback, link-local, private or CGNAT address (R12)     | 76   |
| `redirect-refused`        | The response was a 3xx, which is never followed (R11)                             | 76   |
| `output-collision`        | Two invocations raced for one declared output path                                | 76   |
| `output-oversize`         | A declared output exceeded its cap                                                | 125  |
| `response-oversize`       | A relayed stream hit its byte cap                                                 | 125  |
| `credential-in-output`    | A declared output contained the credential's exact bytes                          | 125  |
| `not-granted`             | No socket exists at the path — nothing is there to decide                         | 127  |

`surface-unverifiable`, `credential-scope` and `destination-unconstrained` are **not** in this set:
they are `check` and `doctor` findings, which block authoring rather than deciding an invocation. A
finding is not a verdict, and the two vocabularies stay separate.

### Confinement

**In this spec:** no shell anywhere on the execution path; the child environment is constructed wholly
from the recipe; a recipe-owned config root; the auth process makes exactly three classes of outbound
call — a target, the approver, and recipe-declared credential-refresh origins — all declared in
artifacts, all recorded, all subject to R1–R14; the journal and credential store live on storage the
sandbox cannot name; concurrency is bounded per credential.

**Deferred, visibly:** a per-recipe execution user, syscall filtering, and an egress namespace. This is
affordable to defer because the principal derives from the receiving socket, so splitting into one
auth process per credential later is a deployment change, not a protocol change. It is also the single
biggest overclaim risk in this spec, which is why it is Q9 rather than a silence.

### Left to the implementation

The framing library, the accept loop, process supervision and backpressure; how `--help` is walked per
target; the rule-matching data structure; budget storage, provided it is keyed and recorded as stated;
and journal layout beyond append-only JSONL in whole UTC day-files.

## Guarantees

| #   | Guarantee                                                                                                                                                                              | Holds because                                                                                                                                                                                                                                                                                                                                                                                                         | Assumes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1  | No credential material is present inside the sandbox at any time                                                                                                                       | The shim is generated with one constant. Credentials are read by the auth process from its own directory and reach a target only via a constructed child environment, a private file under the config root, or an injected header. Declared outputs are scanned for the credential's exact bytes before move-back                                                                                                     | The sandbox's mount set is the workspace plus its grant directory. A target that prints its own credential to stdout defeats this — a recipe defect the scan probe detects, not one the design prevents. For `http`, that the builder places credential material only at the declared injection point, which is mechanical: `Redacted<T>` is consumable only inside the injector                                                                                                                                                                                                                       |
| G2  | A sandbox can invoke exactly the wraps whose sockets exist in its grant directory, and nothing it transmits can change that set                                                        | Wrap identity is the accepting socket's path. The envelope schema rejects unknown keys and has no identity field                                                                                                                                                                                                                                                                                                      | The runtime bind-mounts only that session's directory, and the sandbox uid cannot create files in it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| G3  | Revocation takes effect at the next invocation with no configuration change inside the sandbox                                                                                         | Reachability is the grant; deleting the socket makes `connect(2)` fail                                                                                                                                                                                                                                                                                                                                                | An in-flight invocation runs to completion unless `--kill` is passed, which is an operator action with its own record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| G4  | At most one verdict record per accepted connection, and no target is reached without one                                                                                               | The verdict is the single exit of the decision function and is appended and flushed before the execute call                                                                                                                                                                                                                                                                                                           | The journal accepts the append; if it does not, the invocation is refused rather than executed. A crash between accept and the first append yields zero records and no execution — bounded by `authd.started`/`authd.stopped`                                                                                                                                                                                                                                                                                                                                                                          |
| G5  | A caller can distinguish "policy refused you" from "the tool failed" without parsing prose, and no target runs on a denial                                                             | The `Completion.outcome` enum is authoritative; the denial block has a fixed field set; the execute call is reached only from the allow branch                                                                                                                                                                                                                                                                        | The agent harness reads the completion frame or the reserved exit codes and does not discard stderr                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| G6  | Policy is fail-closed in every direction, including its own failure                                                                                                                    | `default` is schema-constrained to `deny`. No match, unmodeled verb, residual token, type failure, undeployed policy, decision timeout, exhausted budget, unavailable approver and unavailable journal each terminate in deny                                                                                                                                                                                         | The auth process is running; if not, the shim's connect fails, it exits 127, and that attempt is unrecorded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| G7  | The target is never invoked with an argument no rule evaluated                                                                                                                         | The rendering is built only by substituting typed values into positions the recipe enumerates; any argv token the grammar does not consume denies naming that token; no field of the schema has a URL, request-target, method, header-name or query-string value                                                                                                                                                      | For `cli`, that the grammar's extraction is correct for the installed version — defended by G14, not by the type system. **The asymmetry, stated:** argv rendering terminates at `execve`, whose contract is an array of strings and cannot be injected into; `http` rendering terminates at bytes produced by a client this project does not own, assuming that client does not re-normalize a percent-encoded segment, does not accept control bytes in a header value, and does not route through an environment-named proxy. AC-2.8 asserts observed wire bytes rather than the rendering's intent |
| G8  | The target's configuration cannot be influenced from inside the sandbox                                                                                                                | The child environment is constructed wholly from the recipe; `HOME` and every `XDG_*` point at the config root, outside the workspace and outside staging                                                                                                                                                                                                                                                             | The target reads configuration only from its environment, its `HOME`/`XDG` paths, and its cwd. A target reading a fixed absolute path elsewhere is a recipe defect with no mechanical detector                                                                                                                                                                                                                                                                                                                                                                                                         |
| G9  | The bytes the policy inspected are the bytes the target reads                                                                                                                          | Path inputs are copied into a fresh staging directory and digested before policy evaluates; the rebuilt rendering points at the copy; stdin is read in full and digested before normalization and the child's stdin is closed after it; no other channel exists                                                                                                                                                       | Staging is on a filesystem the sandbox cannot write, and per-argument `maxBytes` caps make the copy affordable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| G10 | A path argument names nothing outside the workspace root                                                                                                                               | Resolution refuses every symlink at every component and every escape; the opened file's `dev`+`ino` must match what was stat'd                                                                                                                                                                                                                                                                                        | A kernel offering directory-relative resolution with symlink refusal, where available. The portable resolver leaves a residual race on a directory component swapped between two syscalls, which this guarantee names rather than hides. See Q2                                                                                                                                                                                                                                                                                                                                                        |
| G11 | An irreversible outward action's destination is fixed by enumerable program-side predicates, never by a model alone                                                                    | `destination` is required on every `remote-write` and `irreversible-outward` verb, must occupy a policy-visible rendering position, and `check` fails any `allow` or `ask` rule leaving a destination argument unconstrained by `argEquals`, `argIn` or `argDomainIn`. `deploy` runs `check`                                                                                                                          | Effect classes are correct. The toolkit refuses to infer them and blocks on `unclassified`, so the failure mode is a wrong human classification, not a missing one. For `http`, the author's evidence is provider prose and a method; `evidence` is required and lintable for presence, which makes the classification reviewable and diffable, not true                                                                                                                                                                                                                                               |
| G12 | The approver can only narrow, and sees no attacker-influenceable text                                                                                                                  | `ask` is reachable only from a matched rule; the result is intersected with the program's decision; the brief is built from the typed request and contains no free-form string authored by anyone but the policy author; target output is streamed, never retained where the brief builder can reach it                                                                                                               | A verdict value is constructible only inside the decision module — a lint enforces it. A denied `ask` still transmits `sensitive` values to a third-party provider (Q11)                                                                                                                                                                                                                                                                                                                                                                                                                               |
| G13 | Only a deployed, digest-pinned policy decides                                                                                                                                          | The auth process serves only the deployed set; `deploy` is the sole path and runs the gates first; every verdict carries the digest that produced it                                                                                                                                                                                                                                                                  | The deployed-set directory is writable only by the auth process's owner                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| G14 | A wrapping whose grammar no longer matches its target stops deciding rather than deciding wrongly                                                                                      | Drift on a policy-referenced verb sets a quarantine flag in the deployed set; invocations deny `recipe-drift` until an author re-locks                                                                                                                                                                                                                                                                                | **`cli` targets only.** The drift job runs on schedule against the same binary the auth process executes. **For an `http` target this guarantee does not hold** — there is no local artifact to re-run, no version to pin, and no surface map, so `doctor` has nothing to diff                                                                                                                                                                                                                                                                                                                         |
| G15 | Two wraps over one credential do not corrupt it                                                                                                                                        | Concurrency is a recipe declaration keyed by credential, not by wrap; token refresh runs under the same lock; `credential.bound` records `{id, version}` on every invocation                                                                                                                                                                                                                                          | One auth process owns a given credential                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| G16 | The sandbox can neither produce, alter nor read a journal record, and retention is bounded on both axes                                                                                | Append-only JSONL under the auth process's directory, outside the workspace and every grant directory; ids are minted on this side; whole UTC day-files drop oldest-first at the stated bounds; pre-verdict rejections above a per-principal rate are coalesced into one counted event so flooding cannot buy eviction                                                                                                | The auth process runs as a uid distinct from the sandbox's, and the reader filters by instance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| G17 | Every credentialed outbound request goes to an origin that is a recipe constant bound to that credential's store record, and no field of any request, and no response, can name a host | The origin is parsed once at `check` time into separate `host`/`port` constants; no schema field admits a scheme, host, port, userinfo or URL; no relative reference is ever resolved; redirects are never followed; the credential store declares the origins a credential may be sent to and the auth process refuses to attach it elsewhere; `diff --recipe` classifies an origin change as widening by definition | DNS for the recipe's host is not attacker-controlled after deploy — there is no certificate pinning in this spec — and the runtime address-class refusal is the only network-layer bound, because the auth process is unconfined (Q9)                                                                                                                                                                                                                                                                                                                                                                  |

**Deliberately not guaranteed.** Each of these is a claim a reader would otherwise infer:

- "The sandbox never holds the credential" is **not** "the sandbox gains nothing from the credential".
  A permitted clone has a credentialed process write into a tree the sandbox reads, and the audit
  record is the only thing that distinguishes it from exfiltration.
- The auth process is **not confined** in this spec.
- Partial success of a multi-recipient or multi-target action is not reported.
- Sessions are not mediated; agent-cli mediates invocations.
- **A session's start and end are outside agent-cli's observation**, because it does not create the
  grant directory. A session is bounded only by the records of its own invocations, so one that was
  granted and never invoked is indistinguishable from one that never existed, and the boundary between
  two consecutive sessions rests on their directory names differing. Emitting that observation would
  belong to `agent-environment`, which is part of Q3.
- Recipe-authoring correctness has no mechanical detector.
- For an `http` target, a provider changing a verb's grammar or effect is undetected, and the
  quarantine mechanism does not fire.
- For an `http` target, a provider that signals authorization failure in the response body rather than
  the HTTP status produces exit 0 and its error body on stdout; agent-cli does not parse target
  output, and inventing a verdict from a body is parsing it (Q15).
- On a non-2xx the agent gets exit 1 and the provider's error body on stdout, with no agent-cli
  authored explanation, because agent-cli never writes on the target's channel.

## Audit surface

Required by [ADR-0003](../../adr/0003-auditability-is-a-requirement.md), answered in its six parts.

### 1. What is recorded

A closed set of dotted `<noun>.<action>` names, listed once here. This table and the code's
`AUDIT_EVENTS` const tuple are checked equal **in both directions** by `pnpm check`; a name outside the
tuple is a compile error. Three envelopes, always present, never optional: **P** (`ts`, `event`,
`schemaVersion`, `seq`, `host`, `authdId`); **A** = P + `actor{osUser, gitAuthor}` + `gitCommit`;
**R** = P + `principal{app, instance, session, wrap}` + `requestId` + `recipe` + `policy` +
`policyDigest` + `recipeDigest` + `surfaceDigest`.

| Event                  | Env | Fires when                                                                              | Fields beyond the envelope                                                                                                                    |
| ---------------------- | --- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `authd.started`        | P   | Accepting connections begins                                                            | `deployedSetDigest`, `wrapCount`, `journalPath`                                                                                               |
| `authd.stopped`        | P   | Accepting stops, cleanly or on signal                                                   | `cause`, `inFlightCount`                                                                                                                      |
| `audit.pruned`         | P   | Retention drops day-files                                                               | `rangeStart`, `rangeEnd`, `filesDropped`, `bytesFreed`, `boundHit`                                                                            |
| `recipe.changed`       | A   | `check` accepts a new recipe digest                                                     | `recipe`, `oldDigest`, `newDigest`, `verbsAdded`, `verbsRemoved`, `effectsChanged`                                                            |
| `policy.changed`       | A   | `check` accepts a new policy digest                                                     | `policy`, `oldDigest`, `newDigest`, `verbsWidened`, `verbsNarrowed`, `rulesChanged`, `whyChanged`                                             |
| `wrap.deployed`        | A   | `deploy` publishes a wrap                                                               | `wrap`, `command`, `credentialId`, `credentialVersion`, `origins`, `sockets`, `trialCount`                                                    |
| `wrap.revoked`         | A   | A socket is removed from one session's grant directory                                  | `wrap`, `app`, `instance`, `session`, `reason`, `killedInFlight`                                                                              |
| `wrap.retired`         | A   | `retire` removes a wrap permanently                                                     | `wrap`, `reason`, `retiredPolicyDigest`                                                                                                       |
| `wrap.quarantined`     | A   | Drift on a policy-referenced verb blocks a deployed wrap                                | `wrap`, `driftClass`, `verbs`, `lockedSurfaceDigest`, `observedSurfaceDigest`                                                                 |
| `drift.detected`       | A   | `doctor` finds the installed target differs from the map                                | `recipe`, `class`, `verbs`, `referencedByPolicies`                                                                                            |
| `invocation.received`  | R   | A connection is accepted and its envelope parses                                        | `argvTokenCount`, `argvDigest`, `stdinBytes`, `stdinDigest`, `mode`, `clientPid`                                                              |
| `invocation.rejected`  | R   | The envelope is malformed, oversized, or the wrong version                              | `reason`, `bytesRead`                                                                                                                         |
| `invocation.throttled` | R   | Pre-verdict attempts from one principal exceed the accept rate                          | `windowSeconds`, `attempts`, `firstReason`                                                                                                    |
| `explain.answered`     | R   | An explain-mode request returns                                                         | `verb`, `would`, `wouldReason`, `wouldRuleId`                                                                                                 |
| `request.unmapped`     | R   | argv matches no verb, leaves a token, or fails a type                                   | `reason`, `token`, `nearestVerbs`                                                                                                             |
| `path.staged`          | R   | An input is snapshotted                                                                 | `arg`, `bytes`, `digest`, `stagingId`                                                                                                         |
| `path.rejected`        | R   | A path escapes, is not regular, is oversized, or a declared output fails its post-check | `phase`, `arg`, `reason`                                                                                                                      |
| `budget.exhausted`     | R   | A budget bound denies                                                                   | `budget`, `window`, `observed`, `limit`                                                                                                       |
| `approver.consulted`   | R   | An `ask` rule sends a brief and receives an answer                                      | `question`, `verb`, `effect`, `model`, `latencyMs`, `shownFields[]` with per-field byte count and digest, `returnedVerdict`, `returnedReason` |
| `approver.failed`      | R   | Unavailable, timed out, rate-limited, or off-schema                                     | `failure`, `latencyMs`                                                                                                                        |
| `verdict.allowed`      | R   | The final decision is allow, before anything is reached                                 | `request` (normalized, redacted), `reason`, `decider`, `ruleId`, `verb`, `effect`                                                             |
| `verdict.denied`       | R   | The final decision is deny                                                              | As above, plus `remedy`                                                                                                                       |
| `credential.bound`     | R   | A credential is attached to an execution about to run                                   | `credentialId`, `credentialVersion`, `kind`, `scopes`, `boundVia`                                                                             |
| `execution.started`    | R   | The target is reached                                                                   | `execId`, `execRenderingDigest`, `stagingId`, `pid` (`cli`) or `origin`, `method`, `segmentCount` (`http`)                                    |
| `execution.completed`  | R   | The target finishes on its own                                                          | `execId`, `exitCode`, `outcome`, `durationMs`, `stdoutBytes`, `stdoutDigest`, `stderrBytes`, `stderrDigest`                                   |
| `execution.timeout`    | R   | The execution deadline expires                                                          | `execId`, `outcome`, `signalsSent`, `graceMs`, `durationMs`                                                                                   |
| `execution.cancelled`  | R   | The shim disconnects or forwards a signal                                               | `execId`, `outcome`, `cause`, `durationMs`                                                                                                    |
| `output.truncated`     | R   | A stream hits its byte cap                                                              | `stream`, `capBytes`, `discardedBytes`                                                                                                        |
| `output.rejected`      | R   | Declared outputs fail their post-execution check                                        | `arg`, `reason` (`collision`, `oversize`, `credential-in-output`)                                                                             |

`outcome` is `success | failure | unknown`, describes **execution only**, and is required on every
terminal execution event. An interrupted `irreversible-outward` verb records `unknown`, because that
is what is true; an absent field would not be that answer. Every verdict event carries the request,
verdict, reason, decider, matched rule and `policyDigest`, as ADR-0003 demands literally. Authoring
events are inside the closed set on purpose: editing a policy is the highest-privilege action in this
system. `execution.started`'s field shape is a union discriminated on target kind, and a record mixing
arms fails validation.

### 2. On whose behalf

Every request-scope event carries `principal = {app, instance, session, wrap}`, every field derived
from the accepting socket's path `grants/<app>/<instance>/<session>/<command>.sock` — see
[ADR-0005](../../adr/0005-socket-derived-principal-and-grant-layout.md). The envelope has no field in
which identity could be asserted. Authoring and deployment events carry `actor = {osUser, gitAuthor}`
and `gitCommit`, because the accountable party for a policy edit is a person. An event with neither
principal nor actor fails schema validation and is a compile error to construct.

### 3. Correlation

`requestId` (per accepted connection), `execId` (per execution — decision and execution are distinct),
`sessionId`/`instanceId`/`app` (from the grant path), `stagingId` (which snapshot bytes an execution
read), `policyDigest`/`recipeDigest`/`surfaceDigest` (which text decided), and `seq` (monotonic per
journal). `authd.started`/`authd.stopped` bound any interval in which the process was not accepting,
so a gap in a session is explicable rather than ambiguous.

### 4. Destination and readership

Append-only JSONL, one file per UTC day, **one journal per auth process**, under that process's own
directory — outside the workspace, outside every grant directory, on a filesystem the sandbox does not
mount. Readable by the owner of that auth process. `journal` and `observe` filter by instance and
refuse request ids and sessions outside the caller's instance. There is no cross-instance reader and
no reader inside a sandbox at all: a sandbox learns only what its own denial block tells it.

### 5. Retention

**30 days or 2 GiB per auth process, whichever binds first.** At either bound, whole day-files are
dropped oldest-first — never partially, so no record is ever truncated mid-JSON — and `audit.pruned`
names the range and which bound triggered it. There are no rollups: a pruned range is unavailable, and
`journal --request` on a pruned id returns `pruned` with the range rather than "not found". Unbounded
retention is **not expressible** — both bounds are required fields with no "unlimited" value.
Retention is adversarially reachable, so pre-verdict rejections above a per-principal accept rate are
coalesced into `invocation.throttled` with a count rather than written one record per attempt.

### 6. Never recorded

| Never recorded                                        | Enforced by                                                                                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential material in any form, including its length | `Redacted<T>` with no `toJSON`/`toString`; a lint forbidding fields named token/password/secret/authorization/cookie in any audit payload type |
| The child's environment values                        | The payload type admits environment variable **names** only                                                                                    |
| stdin, stdout, stderr and response bytes              | Streams are relayed, not buffered into records; only counts and digests are typed into the payload                                             |
| Values of `redact` fields                             | Applied during normalization, before the request exists in a loggable form                                                                     |
| Values of `sensitive` fields                          | Present to the approver's brief; digest and length only in the journal. The two paths take different types                                     |
| Workspace file contents                               | `path.staged` records argument, count and digest; the recorder never reads the copy                                                            |
| Response headers                                      | Never read into any typed path                                                                                                                 |
| The model's reasoning beyond its returned `reason`    | The response schema has three fields; anything else is discarded before typing                                                                 |
| Any free-form operator or debug string                | `Fields` is a closed typed shape per event with no `any` and no index signature                                                                |

## Edge cases

### Concurrent

| Case                                                  | Behaviour                                                                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Two invocations over one credential                   | Bounded by the recipe's concurrency declaration, keyed by credential. Over the bound, wait `queueMaxMs` then deny `busy`, exit 76. |
| A token refresh races an invocation                   | Refresh runs under the same credential-keyed lock. `credential.bound` never records two versions across overlapping executions.    |
| Two invocations declare the same output path          | Resolved by an atomic no-replace rename; the loser records `output-collision` and exits 76.                                        |
| A sandbox restarts inside a budget window             | The budget does **not** reset — budgets key on `(instance, wrap)`, not on session.                                                 |
| A wrap is quarantined while invocations are in flight | In-flight invocations complete; the next one denies `recipe-drift`.                                                                |

### Absent

| Case                                             | Behaviour                                                                                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| The auth process is not running                  | `connect(2)` fails, the shim exits 127, and the attempt is unrecorded (stated in G6's Assumes).                                    |
| The journal cannot be appended to                | The invocation is refused rather than executed (G4).                                                                               |
| The approver is unavailable, slow, or off-schema | Deny, with a distinct reason code per mode, decider `runtime`.                                                                     |
| The credential is expired or revoked             | The target's own auth failure passes through as `outcome: failure`. agent-cli does not pre-validate a credential it did not issue. |
| A referenced policy is not in the deployed set   | Deny. Only the deployed set decides (G13).                                                                                         |

### Malformed

| Case                                                   | Behaviour                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Short or long stdin read against `stdinBytes`          | `malformed-envelope`. The count is declared, not discovered.                                                       |
| Unknown envelope key, or wrong version                 | `invocation.rejected`. The schema rejects unknown keys.                                                            |
| Invalid UTF-8 in argv                                  | `malformed-envelope`. A target needing non-UTF-8 argv is unwrappable in this spec.                                 |
| A rule unreachable because an earlier rule subsumes it | `check` fails before deploy.                                                                                       |
| Two verbs whose `match` sequences collide              | `check` fails. Longest match wins, and a proper-prefix relationship requires the shorter to declare `exact: true`. |

### Hostile

| Case                                                            | Behaviour                                                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A residual or forbidden token                                   | Denial naming the token. Total match, G7.                                                                                                         |
| A `string` value with a leading `@`                             | Refused by the type. Many CLIs read `@file` as a file reference.                                                                                  |
| A symlink at any path component, or a `..` escape               | `path-escape`, before policy, naming the parameter and not the resolved path (G10).                                                               |
| A workspace file rewritten between verdict and execution        | The target reads the staged copy, whose digest the policy saw (G9).                                                                               |
| A planted `.netrc`, `.gitconfig`, `hosts.yml` or `curlrc`       | Never read: `HOME` and `XDG_*` point at the config root, outside the workspace (G8).                                                              |
| A hostile `argv[0]` on the shim                                 | Ignored — the socket path is a compiled-in constant, never derived from `argv[0]`.                                                                |
| Prompt injection in an argument aimed at the approver           | The brief contains no free-form string authored by a sandbox, including a prior denial's `detail` (G12).                                          |
| Prompt injection in the **target's own output**                 | Target output is streamed and never retained where the brief builder can reach it. It never reaches policy, the approver, or a typed audit field. |
| `..`, `%2e%2e`, `%2E%2E`, `.%2e` or a `/`-bearing segment value | Refused in the type layer after repeated percent-decoding to a fixed point, reason `segment-refused` (R3).                                        |
| An empty segment, a backslash, or an absolute URL in a segment  | Refused (R3, R4). No scheme, host, port or URL field exists to bind (G17).                                                                        |
| A 3xx pointing at another host                                  | Never followed; returns as a non-2xx. The credential could not follow anyway — it is bound to the recipe's origin (R11, G17).                     |
| CRLF in a value destined for a header                           | Unexpressible: header values admit recipe literals only, and there is no binding syntax in a header position (R6).                                |
| A value containing `&channel=…` or `","channel":"…"`            | Query values are percent-encoded pair-wise; JSON bodies are built as objects and serialized. Neither can become structure (R5, R8).               |
| A hostile recipe **literal** carrying the traversal instead     | Literals get the same encoder and the same universal rejections at `check` time (R2, R3). No toolkit command takes an author-supplied URL.        |
| Flooding pre-verdict rejections to evict older records          | Coalesced into one counted `invocation.throttled` above a per-principal accept rate (G16).                                                        |

### Oversized

| Case                                    | Behaviour                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| Output beyond the stream cap            | Stream stops, `output.truncated`, exit 125. For `http`, measured on decoded relayed bytes. |
| A staged input beyond its `maxBytes`    | `path.rejected` before policy.                                                             |
| An encoded request-target beyond 2048 B | Deny, `request-target-oversize` (R10).                                                     |
| A journal past either retention bound   | Whole day-files drop oldest-first, `audit.pruned` names the bound.                         |

### Interrupted

| Case                                                       | Behaviour                                                                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The shim disconnects                                       | Connection close is a cancel: the process group is killed, `execution.cancelled`.                                                                       |
| An irreversible verb interrupted mid-flight                | `outcome: unknown` — never success, never failure. For `http`, a timeout after the request was written is genuinely indeterminate and is a common mode. |
| The auth process is killed between accept and first append | Zero records and no execution, bounded by `authd.started`/`authd.stopped`.                                                                              |
| Execution deadline expires                                 | SIGTERM, grace, SIGKILL at process-group level; exit 124.                                                                                               |

## Non-goals

Each with a one-line reason, so a later reader can tell _not yet_ from _not ever_.

**Mediation shape.** Credential brokering or token injection (not ever — owner decision). Mediating
sessions rather than invocations, including IMAP IDLE and REPLs (not yet — agent-cli mediates
invocations, not connections). Allocating a PTY (not ever under this architecture). Network egress
control (not ever — wrong component; that is the bridge's job).

**Policy expressiveness.** An expression language or plugin hook (not ever in this form — it destroys
the offline test, the semantic diff and drift detection at once). Stateful predicates (not yet). A
third verdict escalating to a human (owner question Q4 — the answer changes the verdict enum and the
event set, both binding on acceptance). Repeat or replay detection (not yet — a digest window cannot
distinguish an unintended retry from an intended second send, and `outcome: unknown` is exactly where
it guesses wrong). Wrapping general-purpose HTTP clients or API escape hatches including `gh api` and
`curl` (not yet — the request-target would be under the sandbox's control at invocation time, which is
unenumerable and passes through no gate). Composing messages on behalf of a target (not ever — header
construction from untrusted fields is a policy bypass: a CRLF in a subject injects a `Bcc:` and defeats
every recipient allowlist). Verbs that read configuration, hooks or templates from a sandbox-writable
path (not ever without a mechanism making the target ignore workspace configuration). Letting any part
of a rendering be determined by a response — a followed redirect, an opaque next-URL, a response-named
upload host (not ever — the server would become an author of the request). Reading a machine-readable
API description to scaffold an `http` recipe (not yet — no shipped example has one worth walking, and
the fetch itself would be a general HTTP client with the auth host's network position).

**What is recorded.** Target stdout/stderr and response bodies (not ever by default). Parsing target
output for any purpose, including partial-success reporting (not yet). Cross-instance journal reads
(not ever). Retroactive policy application (not ever — that is what makes the log evidence). Rollups
or summaries surviving a prune (not yet — "records older than the bound are unavailable" is a defined
behaviour and is honest).

**Operations.** Confining the auth process (not yet, deliberately visible — Q9). A distributed auth
process (not yet). Credential issuance, rotation UX or a secret backend (not yet). A web or GUI review
surface (not yet). Shipping target binaries — if a target exists as neither a third-party CLI nor an
API, agent-cli does not wrap it here (not yet). Production shims in other languages and a conformance
suite (not yet — the wire contract is written down, which is the modularity artifact; a second
implementation is an addition, not a rewrite). Recipe or policy sharing between installations (not
yet). Windows or non-POSIX hosts (not ever in this spec).

## Scoping guidance

**This spec owns the decision about one invocation, and the toolkit that makes that decision cheap to
author, test, review and repair.** The sharpest directional test: a change that adds runtime
capability and no authoring, testing, review or repair surface is the one to argue about.

| The change…                                                                          | In?     | Test                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Touches how an invocation is normalized, decided, staged or rendered                 | In      | If it changes what the target receives or what the policy sees, it is in                                                                                                                                                                                                                       |
| Makes a recipe or policy cheaper to write, test, diff or repair                      | In      | If it removes an authoring step or turns a promise red in CI, it is in — and it is the priority                                                                                                                                                                                                |
| Adds a toolkit command                                                               | **Out** | The fifteen commands are enumerated in Architecture. A command not on that list is a later spec regardless of usefulness                                                                                                                                                                       |
| Changes what appears in the journal, or what is redacted                             | In      | Binding on acceptance; a change is an amendment to this spec, never a milestone decision                                                                                                                                                                                                       |
| Edits a Dockerfile, a mount table, or how a sandbox is started                       | Out     | agent-environment. agent-cli assumes a workspace at an identical path and a grant directory; it creates neither                                                                                                                                                                                |
| Adds network egress other than a target, the approver, and a declared refresh origin | Out     | The bridge owns egress                                                                                                                                                                                                                                                                         |
| Decides who may create wraps, sign in, or be billed                                  | Out     | agent-server                                                                                                                                                                                                                                                                                   |
| Needs state carried between two invocations                                          | Out     | agent-cli mediates invocations, not connections                                                                                                                                                                                                                                                |
| Parses target output for anything but bytes and digests                              | Out     | Target output is attacker-influenceable and never reaches policy, the approver, or a typed audit field. The one exception is stated where it lives: an HTTP status is the analogue of an exit code, is collapsed to one bit, and never reaches policy, the approver, or a drift classification |
| Lets any part of a rendering be determined by a response                             | Out     | Regardless of how bounded it looks — the server becomes an author of the request                                                                                                                                                                                                               |
| Wraps a target as `http` when a packaged argv-driven binary exists                   | Out     | Prefer `cli`: it gets a scaffolder and a re-runnable artifact for drift, and G14 holds for it                                                                                                                                                                                                  |
| Makes a policy impossible to evaluate by reading it                                  | Out     | Enumerability buys the offline test, the semantic diff and drift detection; losing it costs all three                                                                                                                                                                                          |
| Ships a target binary                                                                | Out     | If a target exists as neither a third-party CLI nor an API, it is not wrapped here                                                                                                                                                                                                             |

## Acceptance criteria

**Group 1 — the invocation path.**

| ID     | Criterion                                                                                                                                                                                                                                                                                                                          | Verified by                                                                                                                                                                   |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1.1 | An allowed invocation returns the target's stdout, stderr and exit code unchanged with the streams never merged; a denial exits 77, prints the canonical block with its exact field set, and reaches no target. For an `http` target, stderr is empty, `stderrBytes` is 0, and no agent-cli-authored byte appears on either stream | e2e byte-comparison against reaching the target directly, with separate-fd assertions and a per-kind arm; process accounting over a denial suite showing zero executions (G5) |
| AC-1.2 | At most one verdict record per accepted connection, no duplicates by `requestId`, and `count(execution.started) ≤ count(verdict.allowed)` under randomized interruption including SIGKILL mid-decision                                                                                                                             | Chaos harness, 10,000 connections (G4)                                                                                                                                        |
| AC-1.3 | Both deadlines are finite and terminate at process-group level: a decision timeout denies with decider `runtime`; an execution timeout SIGTERMs then SIGKILLs; a shim disconnect kills the child                                                                                                                                   | Fault injection per case, with `ps` showing zero surviving descendants and the matching record present                                                                        |
| AC-1.4 | The reserved exit codes map one-to-one onto reason-code classes and `Completion.outcome` agrees with the exit code in every case; an `http` execution exits 0 on 2xx and 1 on every other status                                                                                                                                   | Table-driven test over one seeded case per reason code, plus one seeded case per HTTP status class                                                                            |

**Group 2 — the trust boundary under attack.**

| ID     | Criterion                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Verified by                                                                                                                                                                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-2.1 | After 500 mixed invocations, a scan of the sandbox filesystem — including every declared output moved back into the workspace — every process environment, every argv and every returned stream finds zero occurrences of any credential's material                                                                                                                                                                                                                                   | Credential scanner, with an explicit `.git/config` assertion after a clone-shaped verb (G1)                                                                                                                                                                                                            |
| AC-2.2 | A sandbox cannot name or invoke an ungranted wrap, and revocation is deleting a file                                                                                                                                                                                                                                                                                                                                                                                                  | Schema test proving the envelope has no identity field; connecting to an ungranted path fails; a shim invoked with a hostile `argv[0]` still reaches only its compiled-in socket; `revoke` removes the socket, the next invocation exits 127, and a pre-revocation `requestId` still resolves (G2, G3) |
| AC-2.3 | Neither the sandbox environment nor files planted in the workspace influence the target's configuration                                                                                                                                                                                                                                                                                                                                                                               | Probe target printing its environ and config search path: the printed environment equals the recipe's declaration exactly for arbitrary sandbox-side variables; `.netrc`, `.gitconfig`, `hosts.yml` and `curlrc` planted in the workspace change nothing (G8)                                          |
| AC-2.4 | Workspace containment holds against escape and races, and the bytes the policy hashed are the bytes the target reads for argv, stdin and staged files                                                                                                                                                                                                                                                                                                                                 | Escape suite (`..`, symlink at every component, hardlink, bind mount, racing directory swap); 1,000 trials rewriting a workspace file during the verdict window asserting the staged digest equals what the target opened; a post-verdict stdin write is refused (G9, G10)                             |
| AC-2.5 | Unmodeled and forbidden tokens are unreachable: no allow ever carries a residual token, a `string` value with a leading `@` is refused, `check` rejects a recipe modelling a `neverModel` token, and a recipe **literal** is subject to the same encoder and the same universal rejections as a bound value                                                                                                                                                                           | argv fuzzer over every shipped recipe; seeded recipe fixtures including hostile literals (G7)                                                                                                                                                                                                          |
| AC-2.6 | Only a deployed digest-pinned policy decides                                                                                                                                                                                                                                                                                                                                                                                                                                          | Editing a policy file while the auth process runs changes no verdict; every verdict digest is a member of the most recent `wrap.deployed` set across a full journal; each seeded gate failure blocks deploy with the running configuration unchanged (G13)                                             |
| AC-2.7 | A destination is never determined by an argument value that expands: an `email` argument containing a comma, angle brackets, a display name, whitespace or a control byte is refused before policy, and `argDomainIn` matches only the validated domain part                                                                                                                                                                                                                          | Type-conformance corpus over the `email` type and `argDomainIn`, against a seeded recipe fixture rather than a shipped recipe, because this spec ships no `email`-typed argument (see Q14)                                                                                                             |
| AC-2.8 | For every bound and literal position of every shipped `http` recipe, the values `..`, `.`, `%2e%2e`, `%2E%2E`, `.%2e`, `/`, `%2F`, `\`, the empty string, CR, LF, `&`, `=`, `#`, `?`, an absolute URL, and a `//host` prefix each produce **either** a denial with a reason code **or** a request whose observed origin, segment count, request-target bytes and header set equal the recipe's declaration; and a 3xx response is refused rather than followed                        | A **local capture server** asserting the bytes it received — the request line and the raw header block — never the rendering's intent. The corpus is generated from the recipe, so a new verb is covered automatically. Re-run as a gate on any HTTP-client or runtime minor-version bump (G7, G17)    |
| AC-2.9 | The origin is fixed and credential-bound: `check` rejects an origin with userinfo, a path, a query, a fragment, a non-`https` scheme, or an IP literal; `deploy` fails a wrap whose recipe origin is absent from its credential record's origin list; at runtime the credential is not attached to any other origin and a connection to a resolved loopback, link-local, private or CGNAT address is refused; `diff --recipe` exits non-zero on any origin change regardless of `why` | Seeded hostile-origin fixtures, one per rejection class; a wrap whose origin is edited post-deploy; a resolver stub returning a link-local address; a `diff` fixture (G17)                                                                                                                             |

**Group 3 — policy and approver as a ceiling.**

| ID     | Criterion                                                                                                                                                                                                               | Verified by                                                                                                                                                   |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-3.1 | Policy is fail-closed: every shipped policy's `default` is `deny`, and an exhaustive trial over each recipe's full verb set reaches allow only via a named matching rule                                                | Schema test plus exhaustive trial (G6)                                                                                                                        |
| AC-3.2 | An always-allow approver produces a verdict set identical to the one produced by a deny-only approver on every trial in the corpus; unavailable, timeout, rate-limited and off-schema each deny with a distinct reason  | Approver substitution across the whole corpus; fault injection per mode (G12)                                                                                 |
| AC-3.3 | The approver is blind: a canary string emitted by a probe target never appears in any brief, and the brief contains no string authored by a sandbox, including a prior denial's `detail`                                | Brief-construction tests plus a two-turn injection scenario that plants an instruction in a residual token and asserts it is absent from the next brief (G12) |
| AC-3.4 | `check` fails any `allow` or `ask` rule over a `remote-write` or `irreversible-outward` verb leaving a destination argument unconstrained, and a size, count, rate or budget predicate does not satisfy the requirement | Seeded negative fixtures, one per non-qualifying predicate (G11)                                                                                              |
| AC-3.5 | A budget survives a sandbox restart: exhausting a wrap's hourly budget, then starting a new session against the same instance, still denies with `budget-exhausted` and zero `execution.started`                        | e2e with a session teardown mid-window                                                                                                                        |

**Group 4 — the audit surface is mechanical and bounded.**

| ID     | Criterion                                                                                                                                                                                                                                                                                                                                                                                                                             | Verified by                                                                                                                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-4.1 | The event contract is enforced by the toolchain: the names in this spec's table and the code's const tuple are equal in both directions, an unlisted name is a compile error, every record validates against its declared per-event field shape, `surfaceDigest` is `string \| null` and is null for every `http` recipe, and `execution.started`'s shape is a union discriminated on target kind in which a record mixing arms fails | Two-way set check in `pnpm check` parsing this spec's table; a fixture emitting an unlisted name failing type-check; schema validation over a two-kind journal                                                                                                                       |
| AC-4.2 | One session reconstructs end to end from the journal alone, across a sandbox restart                                                                                                                                                                                                                                                                                                                                                  | A synthetic multi-session fixture of known shape (n invocations, k denials, one cancellation, one timeout, one approver consultation) replaying by `sessionId` into exactly that shape, with the second session distinct                                                             |
| AC-4.3 | Retention is bounded on both axes with the stated behaviour at each bound, and flooding cannot buy eviction                                                                                                                                                                                                                                                                                                                           | Driving a journal past its size and age bounds: whole day-files drop oldest-first, `audit.pruned` names the range and which bound bound, every remaining line parses; a pre-verdict flood produces coalesced `invocation.throttled` records rather than one record per attempt (G16) |
| AC-4.4 | The journal leaks nothing and is unreachable from the sandbox                                                                                                                                                                                                                                                                                                                                                                         | Scanner over a journal from a run passing credential-shaped, `redact` and `sensitive` values, asserting zero occurrences and `sensitive` present only as a digest; an in-sandbox search finding no journal path; `journal --request` refusing an id from another instance (G16)      |

**Group 5 — authoring is cheap, and measured (DG2).**

| ID     | Criterion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Verified by                                                                                                                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-5.1 | Authoring increments are exact: a second policy over an existing recipe adds one policy file, one wrap file and one trials file and modifies no recipe, surface map or shim; adding one verb is one recipe edit plus one trial and touches no policy that does not reference it                                                                                                                                                                                                                                                                                                                                                                                                                                                       | A test over the file set of both diffs                                                                                                                                                                                                                                              |
| AC-5.2 | A wrap cannot ship incomplete: `check` fails on an unclassified effect, an empty `why`, a missing trials file, an unreachable rule, an unconstrained destination, a verb-match prefix collision, a policy whose permitted effects exceed its wrap credential's declared scopes, a non-null `configRoot` on an `http` recipe, a binding in a header position, a header name the emitter owns or the credential injects into in any case form, a duplicate recipe-authored query key, a `{arg}` absent from the path array, a `json` body field deriving from a `workspace-path`, a `destination` argument in a non-policy-visible position, a `GET` or `DELETE` verb with a non-`none` body, and an empty `evidence` on an `http` verb | One seeded fixture per gate, each failing `pnpm check` with an error naming file, field and fixing command                                                                                                                                                                          |
| AC-5.3 | Both dry-run paths answer "would this be allowed, and why" without executing, without binding a credential and without consulting the approver, and print the exact rendering with a `kind` discriminator                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Golden `simulate` output per kind showing verdict, matched rule, remedy, the would-be rendering and the exact brief; an explain-only session producing zero `credential.bound`, zero `execution.started`, zero `approver.consulted`, and one `explain.answered` per call            |
| AC-5.4 | The cost of a first wrap over each kind is published: hand-edited lines per shipped verb and elapsed agent time to a first passing trial, with owner intervention limited to assigning effect classes, measured against a week of real invocation traces                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | The M1 QA doc, against the thresholds in AC-5.5                                                                                                                                                                                                                                     |
| AC-5.5 | The DG2 thresholds are met: **T1** median ≤ 12 hand-edited lines per shipped `cli` verb over ≥ 8 `gh` verbs; **T2** median ≤ 25 hand-edited lines per shipped `http` verb over ≥ 4 hand-written verbs; **T3** ≤ 90 minutes of agent session time to first green `test` for the `cli` recipe and ≤ 120 for the `http` recipe, with owner intervention limited to assigning effect classes and answering "is this reversible", and more than 3 interventions outside those two categories failing regardless of the clock; **T4** a second policy over an existing recipe of either kind touches exactly 3 files and 0 lines of any recipe, surface map or shim                                                                         | T1/T2: `git diff --numstat` on the recipe file between the scaffold commit and the commit at which `test` first passes, divided by verbs shipped. T3: summed session durations plus the intervention log, in the M1 QA doc. T4: the file-set test backing AC-5.1, run once per kind |

**Group 6 — maintenance is a mechanism (DG2).**

| ID     | Criterion                                                                                                                                                                                                                                                                                                                            | Verified by                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| AC-6.1 | Drift is classified and quarantines only when it matters, **for `cli` targets**: a policy-referenced verb whose grammar moved denies at runtime with `recipe-drift` until re-locked; an added-upstream verb is informational with no quarantine; an unrunnable target is `surface-unverifiable`, blocking in CI and not quarantining | A fixture target whose help output is mutated per class (G14)                                     |
| AC-6.2 | Review runs in both directions and applies nothing: `diff` reports a change as verbs moved between verdicts and fails a `deny → allow` with an unchanged `why`; `observe` proposes widenings from grouped denials and narrowings from never-invoked rules, and no artifact on disk changes                                           | Seeded policy edits; a synthetic 7-day journal containing one unused rule and one repeated denial |
| AC-6.3 | Trials stay current by construction: `test --update` surfaces an edit as a diff of observed verdicts and reasons; `trial add --from <requestId>` turns a real denial into a test that is red before the intended edit and green after                                                                                                | An edit to one rule; a captured denial round-tripped                                              |

**Group 7 — generalization and stack (DG5, DG7).**

| ID     | Criterion                                                                                                                                                                                                                                                                                                                                                                                                                                          | Verified by                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| AC-7.1 | **github**: two policies over one `gh` recipe — read-only, and read-plus-comment — deploy, share one surface map, and behave as their trials state; an unmodeled subcommand denies as `unmapped-verb` and appears in `doctor`'s ranked list                                                                                                                                                                                                        | e2e against a real repository plus a `doctor` run                                                  |
| AC-7.2 | **slack**: an `http` target with a rotating bearer credential ships two policies over one recipe; its send verb declares a `destination` constrained by an enumerable predicate; the two wraps never hold the credential's refresh lock concurrently and `credential.bound` never records two versions across overlapping executions; an interrupted send records `outcome: unknown`                                                               | e2e against a real workspace; forced rotation mid-run; 100 interleaved invocations (G11, G15, G17) |
| AC-7.3 | An interrupted irreversible invocation records `outcome: unknown` — never success, never failure — and the journal says so plainly                                                                                                                                                                                                                                                                                                                 | Killing the auth process mid-send and inspecting the record                                        |
| AC-7.4 | The dependency budget and the prose conventions are gates: the lockfile resolves one runtime dependency (or two with the reserved native slot, if Q2 admits it), the shim entrypoint resolves zero, and commented-out code, change-narrating comments, a free-form audit event name, a URL parse on the request path, an error passed through to a frame, and starting under a disabled-certificate-validation environment each turn the build red | Lockfile and resolution checks in `pnpm check`; one seeded fixture per lint rule                   |

## Open questions

| Question                                                                                                                                                                             | Blocks                                                                                                                                      | Resolved by                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q3.** Does `agent-environment` accept `grants/<app>/<instance>/<session>/<command>.sock` as a binding layout? The component that would create it has no spec                       | Every runtime event's principal, and therefore ADR-0003's second question; ADR-0005; AC-4.2                                                 | Owner decision: either this spec defines the layout normatively and agent-environment inherits it, or agent-cli reads an operator-written identity file until that spec exists. Silence produces a fabricated session id                                                                                                                                                        |
| **Q2.** Where does the auth process run? Directory-handle resolution with symlink refusal is Linux-specific and unreachable from the chosen runtime's standard library               | G10's strength and its Assumes column; whether ADR-0006 takes its reserved second dependency; whether macOS is a supported development path | The owner naming the deployment target relative to the Docker runtime the README expects, and whether a strictly weaker portable resolver is acceptable for development but explicitly not for deployment                                                                                                                                                                       |
| **Q4.** Does a third verdict exist — escalate to a human?                                                                                                                            | The verdict enum and the closed event set, both binding on acceptance. Adding a value afterwards is expensive                               | Owner decision on operational grounds: is an agent blocking for minutes on a notification acceptable, or is deny-and-report always right? If no, the non-goal needs a one-line reason distinguishing "not yet" from "not ever"                                                                                                                                                  |
| **Q7.** Does the closed predicate set survive the example policies? The set is eleven predicates and was written before them                                                         | Freezing the policy schema. A later expression language destroys the offline test, the semantic diff and drift detection at once            | Writing two policies per shipped and paper target against the frozen set **before acceptance**, and recording every rule that could not be expressed with what expressing it would have cost                                                                                                                                                                                    |
| **Q16.** Does an HTTP-client or runtime minor-version bump gate on re-running AC-2.8?                                                                                                | Whether G7's `http` clause is enforced or merely stated                                                                                     | Owner/CI decision. The failure mode is invisible to every other gate: `check` passes, every trial passes, no artifact on disk is wrong, and traversal works. If the answer is no, G7's `http` clause is guidance rather than a rule, and design-principles.md says it should be labelled as such                                                                                |
| **Q8.** How wide is a quarantine's blast radius, and is there a break-glass? One upstream release could quarantine every wrap over a recipe across every application                 | Whether G14 is operable. A safety mechanism that takes four applications down on a Tuesday gets disabled, which is worse than not having it | Owner decision on whether an explicit, audited, owner-signed drift acceptance exists, whether it is per-wrap or per-recipe, and whether it expires                                                                                                                                                                                                                              |
| **Q9.** What confinement does the auth process get, and is any of it in this spec? It holds every credential, reaches targets, resolves agent-chosen paths, and makes outbound calls | The honesty of G1 and G17. "The sandbox never holds a credential" is much weaker than it sounds if the process that does is unconfined      | Owner scoping decision on per-recipe execution users, syscall filtering and an egress allowlist. Either answer is fine; silence is not, because this is exactly the mid-build scope argument Scoping guidance exists to settle                                                                                                                                                  |
| **Q13.** Does the auth process get a network egress allowlist, generated from the deployed set rather than authored?                                                                 | Whether G17's "enumerable and gated" becomes "confined"                                                                                     | Owner scoping decision. The set is exactly the origins of every deployed `http` recipe, the approver, and recipe-declared refresh origins — printable by `show --egress`. Generating it costs little; enforcing it needs the namespace Q9 defers, and a generated allowlist that nothing enforces is a mechanism this spec should not pretend to have                           |
| **Q14.** Do the `email` argument type and the `argDomainIn` predicate stay, with no shipped user?                                                                                    | One strict addr-spec parser, one of eleven predicates, and AC-2.7 outright                                                                  | Owner decision. **Recommend keep.** Cutting saves a parser and a predicate but deletes AC-2.7, removes a destination-qualifying predicate G11 leans on, and makes a mail-shaped fifth target a policy-schema change, weakening DG5                                                                                                                                              |
| **Q15.** Is exit 0 acceptable for a provider that signals failure in the response body?                                                                                              | Nothing here; it lands the first time an agent treats a body-level failure as success                                                       | Owner decision after the `http` milestone. The only fix is a per-recipe success predicate over the response body, which **is** parsing target output and is forbidden by Scoping guidance for good reasons. G5 survives strictly — a policy refusal is still 77 and structurally distinguishable — but "the tool failed" versus "it worked" is degraded for this provider class |
| **Q11.** If `ask` stays: is it acceptable that a `sensitive` value this spec refuses to store locally leaves to a third-party model provider, including on a denied request?         | G12's honesty and the never-recorded table. "We do not log it" and "it does not leave" are different claims                                 | Owner decision on whether provider zero-retention is a required assumption stated in the guarantee, whether `ask` is restricted to wraps whose content is already ours, or whether the residue is accepted and written down. `approver.consulted` records per-field byte counts and digests either way, so egress volume is reconstructable                                     |
| **Q10.** Is an unintended double-send acceptable within budget? Replay detection is cut, because a digest window denies exactly the retry that `outcome: unknown` makes legitimate   | Nothing here; the pressure arrives the first time a retry loop double-posts                                                                 | Owner decision after the `http` milestone measures how often an irreversible verb is interrupted in practice. `outcome: unknown` is much more reachable for `http`, where an exchange that times out after the request was written is genuinely indeterminate                                                                                                                   |
| **Q12.** Does the shim's cold start fit inside an agent loop?                                                                                                                        | ADR-0006's revisit trigger and the sandbox image contract agent-environment inherits                                                        | Measuring shim cold start per invocation against a latency the owner names, plus the image-size delta of putting the runtime into a sandbox image, plus confirmation that sandbox images are ours to control                                                                                                                                                                    |

## Changes since acceptance

| Date | Change | Why |
| ---- | ------ | --- |
|      |        |     |
