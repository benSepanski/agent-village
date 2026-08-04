# M4: Slack — an http target, a rotating credential, an irreversible send

Spec: `../spec.md`
Status: Planned
Depends on: M3

## Slice

A real API becomes a wrapped command. The Slack recipe deploys with two policies over one recipe and
two scoped credentials: `slack-readonly` may list and read, `slack-announce` may also post, but only to
channels an `argIn` predicate enumerates. The credential store binds each credential to exactly one
origin, and the auth process refuses at runtime to attach it anywhere else. Token rotation runs under
the same credential-keyed lock as invocation, so two wraps over one credential never hold it
concurrently and `credential.bound` never records two versions across overlapping executions. An
interrupted send records `outcome: unknown` — never success, never failure. `show --egress` prints the
complete, enumerable set of origins this deployment can reach.

This is the first milestone in which **agent-village's own code transmits a credential**. The risk that
could have sunk it — whether the emitted bytes match the emitter's intent — was deliberately settled in
M2 against a local capture server with no credential and no network, so what M4 exercises is the
credential, the lock and the provider, not the emitter.

## Out of scope

| Not here                                 | Where instead                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| The `http` emitter and the escape corpus | M2 (already done)                                                                    |
| `check`/`deploy` origin gates            | M3 (already done)                                                                    |
| Drift, quarantine, `doctor`              | M5 — and G14 does not hold for an `http` target at all                               |
| Retention enforcement, `observe`         | M5                                                                                   |
| The approver and any `ask` rule          | M6                                                                                   |
| A full OAuth authorization-code grant    | Not in this spec — bearer rotation is what is exercised; gmail stays a paper example |

## Acceptance criteria

| ID      | Criterion                                                                                                                                                                                          | Serves         | Verified by                                                                               |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------- |
| AC-M4.1 | Two policies over one Slack recipe deploy against two scoped credentials and behave as their trials state                                                                                          | AC-7.2, AC-5.1 | e2e against a real workspace                                                              |
| AC-M4.2 | The send verb declares `destination: ["channel"]` constrained by `argIn`, and `check` fails the same policy with that constraint removed                                                           | AC-7.2         | The shipped policy, plus a negative fixture                                               |
| AC-M4.3 | At runtime the credential is not attached to any origin other than its store record's, and a connection to a resolved loopback, link-local, private or CGNAT address is refused                    | AC-2.9         | A wrap whose origin is edited post-deploy; a resolver stub returning a link-local address |
| AC-M4.4 | Across 100 interleaved invocations spanning a forced rotation, the two wraps never hold the refresh lock concurrently and `credential.bound` records no two versions across overlapping executions | AC-7.2, AC-3.5 | Interleaving harness with rotation forced mid-run                                         |
| AC-M4.5 | An interrupted send records `outcome: unknown`, and neither `success` nor `failure` appears for it                                                                                                 | AC-7.3         | Killing the auth process mid-send, then inspecting the record                             |
| AC-M4.6 | `show --egress` prints exactly the origins of every deployed `http` recipe, the approver, and every recipe-declared refresh origin — and nothing else                                              | AC-2.9         | Comparison against the deployed set                                                       |
| AC-M4.7 | A non-2xx returns exit 1 with the provider's error body on stdout, `stderrBytes` 0, and no agent-cli-authored byte on either stream                                                                | AC-1.1, AC-1.4 | Forced 401 and 429 against the real provider                                              |

## Audit surface

**Adds no new event names.** That is the result worth stating: a second target of a second kind, with a
refreshable credential and an irreversible verb, is fully describable by the closed set M1–M3 already
declared. This is DG5 evidence arriving two milestones early.

**Field shapes exercised here for the first time:** `execution.started`'s `http` arm (`origin`,
`method`, `segmentCount` — no `pid`), `credential.bound` with `boundVia: "header"` and a
`credentialVersion` that changes mid-run, and `wrap.deployed` carrying `origins`.

**Principal and correlation:** unchanged. `credentialVersion` becomes the field that makes a rotation
reconstructable — which version served which execution, and that no two overlapped.

**Never recorded:** the credential's material or its length, in any error path. This milestone adds the
first code that holds a token in an outgoing header map, so `Redacted<Headers>` and the
`no-error-passthrough` lint are load-bearing here rather than theoretical: a caught client error's
message, cause or serialized form is never interpolated into a frame or an audit field. Response
headers are never read into any typed path.

## Approach

Author the recipe from Slack's published documentation, one verb at a time, each with its required
`evidence` string. Deploy `slack-readonly` first and exercise it before `slack-announce` exists — an
irreversible verb should not be the first thing a new target does.

What could go wrong:

- **Effect misclassification.** This is the unclosed risk, and the spec says so in as many words:
  `evidence` makes a classification reviewable and diffable, **not true**. Providers use POST for
  search and GET for triggers. One wrong classification ships an irreversible verb as `read`, and then
  `destination` never fires, `argIn` never applies, and G11 is defeated with no mechanical detector.
  Read the documentation for each verb rather than inferring from the method.
- **Body-level failure signalling.** Slack returns HTTP 200 with `{"ok":false,"error":"missing_scope"}`.
  Under R11 that is a success: exit 0, error body on stdout. Detecting it would require parsing the
  response body, which Scoping guidance forbids. This is why AC-7.2 carries no drift clause and why
  AC-6.1 is `cli`-only — and it is **open question Q15**.
- **Rotation racing an in-flight send.** The lock is keyed by credential, not by wrap; if that is
  implemented per-wrap by mistake, AC-M4.4 catches it and nothing else will.
- **Channel identifiers are opaque.** `C07J4Q2ZK3M` means nothing to a reviewer. The human label lives
  in the rule's required `why`, because re-resolving a pin would be an unaudited credentialed call to a
  third party.

## Decisions needed

- **Open question Q15** — is exit 0 acceptable for a provider that signals failure in the body? —
  becomes concrete here. Record how often it actually bites before the owner decides.
- **Open question Q10** — is an unintended double-send acceptable within budget? — is measurable from
  this milestone on. `outcome: unknown` is far more reachable for `http`, where an exchange that times
  out after the request was written is genuinely indeterminate.
- **Open question Q13** — a generated egress allowlist — becomes cheap here, because `show --egress`
  already computes the set. Whether anything _enforces_ it depends on Q9, which this spec defers.

## Verification

```bash
pnpm check
agent-cli check && agent-cli test && agent-cli deploy
agent-cli show --egress
```

1. **Read path.** From the sandbox, list conversations through `slack-readonly`. Assert the provider's
   JSON on stdout byte-for-byte, `stderrBytes` 0, exit 0.
2. **Destination.** Post to an enumerated channel through `slack-announce`; assert success. Post to a
   channel outside the `argIn` set; assert exit 77 and `rule-denied`. Then remove the `argIn`
   constraint in a fixture and assert `check` refuses to let it ship.
3. **Origin binding.** Edit a deployed recipe's origin to a look-alike host and re-invoke; assert the
   credential is not attached and the invocation denies. Point the resolver stub at `169.254.169.254`;
   assert `origin-address-refused`. Evidence: both records.
4. **Rotation under load.** Run 100 interleaved invocations across both wraps with rotation forced
   mid-run. Extract every `credential.bound` and every `execution.started`/`execution.completed` pair;
   assert no two overlapping executions carry different `credentialVersion` values. Evidence: the
   interleaving table.
5. **Interruption.** Start a send, kill the auth process after the request bytes are written but before
   the response arrives. Assert the record says `outcome: unknown`, and that neither `success` nor
   `failure` appears. Then check Slack itself for whether the message landed, and record the answer —
   that comparison is the honest content of AC-7.3.
6. **Failure paths.** Force a 401 and a 429. Assert exit 1, the provider's body on stdout, empty
   stderr. Separately, force a body-level `{"ok":false}` and record that it exits 0 — evidence for Q15,
   not a defect.
7. **Egress.** Run `show --egress`; assert the printed set equals the origins of every deployed `http`
   recipe plus the approver plus every declared refresh origin, and contains nothing else.
8. **No leak.** Across the connect-refused, TLS-failure, timeout, abort and DNS-failure paths, scan
   every frame and every journal record for the credential's bytes. Assert zero occurrences.
