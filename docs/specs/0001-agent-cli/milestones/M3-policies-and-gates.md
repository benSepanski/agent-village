# M3: Many policies, and the gates that bite

Spec: `../spec.md`
Status: Planned
Depends on: M2

## Slice

The policy schema freezes, and every promise the toolkit makes turns something red. `agent-cli check`
fails on each condition in AC-5.2 — an unclassified effect, an empty `why`, a missing trials file, an
unreachable rule, an unconstrained destination, a verb-match prefix collision, a policy whose permitted
effects exceed its credential's scopes, and the nine `http` shape gates including the origin gates.
A second policy over the **same** `gh` recipe ships as three files, one hand-written, touching no
recipe, surface map or shim — the DG2 claim, demonstrated rather than argued. `simulate` and in-sandbox
explain both answer "would this be allowed, and why" without executing, without binding a credential
and without consulting the approver. `test --update` and `trial add --from` keep the trials corpus
current by construction. `diff` reports a change as verbs moved between verdicts and is red on any
origin change regardless of `why`. And `deploy`, `revoke` and `retire` become the only paths in and out
of the deployed set.

After this milestone the authoring surface is complete and frozen. M4 adds a target, not a mechanism.

## Out of scope

| Not here                                            | Where instead |
| --------------------------------------------------- | ------------- |
| Any real `http` credential, origin or provider      | M4            |
| Runtime credential-origin refusal                   | M4            |
| `doctor`, drift classification, quarantine          | M5            |
| `observe`, retention enforcement                    | M5            |
| The approver, and any `ask` rule actually consulted | M6            |

## Acceptance criteria

| ID       | Criterion                                                                                                                                                                                                                                                | Serves | Verified by                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-M3.1  | A second policy over an existing recipe adds exactly one policy, one wrap and one trials file, and modifies no recipe, surface map or shim                                                                                                               | AC-5.1 | A test over the file set of the diff                                                                                                              |
| AC-M3.2  | Adding one verb is one recipe edit plus one trial, and touches no policy that does not reference it                                                                                                                                                      | AC-5.1 | A test over the file set of that diff                                                                                                             |
| AC-M3.3  | `check` exits non-zero on every gate listed in AC-5.2, each with an error naming file, field and the command that fixes it                                                                                                                               | AC-5.2 | One seeded fixture per gate                                                                                                                       |
| AC-M3.4  | `check` fails an `allow` or `ask` rule over a `remote-write` or `irreversible-outward` verb leaving a destination argument unconstrained, and size, count, rate and budget predicates do not satisfy it                                                  | AC-3.4 | Seeded negative fixtures, one per non-qualifying predicate                                                                                        |
| AC-M3.5  | `check` rejects an origin with userinfo, a path, a query, a fragment, a non-`https` scheme, or an IP literal; `deploy` fails a wrap whose origin is absent from its credential record's origin list; `diff --recipe` exits non-zero on any origin change | AC-2.9 | Seeded hostile-origin fixtures, one per rejection class, plus a `diff` fixture                                                                    |
| AC-M3.6  | Every shipped policy's `default` is `deny`, and an exhaustive trial over each recipe's full verb set reaches allow only via a named matching rule                                                                                                        | AC-3.1 | Schema test plus exhaustive trial                                                                                                                 |
| AC-M3.7  | Both dry-run paths execute nothing, bind no credential and consult no approver, and print the rendering with a `kind` discriminator                                                                                                                      | AC-5.3 | Golden `simulate` output per kind; an explain-only session producing zero `credential.bound`, zero `execution.started`, zero `approver.consulted` |
| AC-M3.8  | `test --update` surfaces a policy edit as a diff of observed verdicts and reasons; `trial add --from <requestId>` produces a test red before the intended edit and green after                                                                           | AC-6.3 | An edit to one rule; a captured denial round-tripped                                                                                              |
| AC-M3.9  | A budget survives a sandbox restart: exhausting an hourly budget, then starting a new session against the same instance, still denies `budget-exhausted` with zero `execution.started`                                                                   | AC-3.5 | e2e with a session teardown mid-window                                                                                                            |
| AC-M3.10 | Editing an artifact file produces no behaviour change until `deploy` succeeds, and a failed gate leaves the running configuration untouched                                                                                                              | AC-2.6 | Edit-in-place, then each seeded gate failure                                                                                                      |
| AC-M3.11 | Both `gh` policies — `github-readonly` and `github-comment` — deploy, share one surface map, and behave as their trials state; an unmodeled subcommand denies as `unmapped-verb`                                                                         | AC-7.1 | e2e against a real repository. `doctor`'s ranked list of unmodeled commands is M5's half of AC-7.1                                                |

## Audit surface

**Adds:** `budget.exhausted`, `wrap.revoked`, `wrap.retired`. `policy.changed` and `recipe.changed`
carry their full field sets from here on: `verbsWidened`, `verbsNarrowed`, `rulesChanged`,
`whyChanged` for a policy; `verbsAdded`, `verbsRemoved`, `effectsChanged` for a recipe.

**Principal:** authoring and deployment events carry `actor = {osUser, gitAuthor}` and `gitCommit`,
because the accountable party for a policy edit is a person, not a session. This milestone is where
that distinction first matters — editing a policy is the highest-privilege action in this system, which
is why authoring events are inside the closed set at all.

**Correlation:** `policyDigest` becomes load-bearing here. Every verdict carries the digest of the text
that produced it, and `journal --request` resolves it to that exact text even after a redeploy.

**Never recorded:** unchanged. `simulate` and explain produce no credential id, no version and no
absolute path; explain's response is a strict subset of the denial block.

**Retention:** still declared, still enforced in M5.

## Approach

Freeze the schema first, then write the gates against it, then prove the increments. The order matters:
a gate written before the schema is frozen tests a moving target.

The second `gh` policy is the point of the milestone, not a side effect. If it turns out to need a
recipe edit, the recipe/policy split is not orthogonal and DG2's central claim is wrong — better to
find that here than after four more targets exist.

What could go wrong:

- **The closed predicate set is insufficient.** This is open question Q7, and this is the milestone
  that answers it. Writing two policies per target against eleven predicates is the test. There is no
  escape hatch by design: the options are a bounded approximation, routing the residue to `ask` inside
  an already-bounded destination, or recording the gap. Adding an expression language would destroy the
  offline test, the semantic diff and drift detection at once.
- **`check` gates that are individually right and collectively unusable.** Fifteen gates that each fire
  on a plausible authoring mistake would make the first recipe miserable to write, which is a DG2
  failure even though every gate is correct. Watch T1 and T3 as the gate count grows.
- **A gate that cannot name its fix.** An error that says what is wrong but not what to type is a
  worse-than-nothing gate for an agent author.

## Decisions needed

- **Open question Q7 is settled here or not at all.** Write two policies per target — for the shipped
  and paper targets alike — against the frozen predicate set, and record every rule that could not be
  expressed along with what expressing it would have cost. That record is the input to the owner's
  decision, per [author-a-spec](../../../dev/workflows/author-a-spec.md).
- Whether `argDomainIn` and the `email` type survive with no shipped user is **open question Q14**.
  This milestone's seeded fixtures are what keeps them verifiable either way.

## Verification

```bash
pnpm check
agent-cli check && agent-cli test && agent-cli diff --against HEAD && agent-cli deploy
```

1. **The increment.** Author `github-comment` over the existing `github` recipe. Run
   `git diff --stat`. Assert exactly three files added and zero lines changed in any recipe, surface
   map or shim. Evidence: the diffstat.
2. **Every gate.** For each condition in AC-5.2, deploy the seeded fixture and run `check`. Assert a
   non-zero exit and capture the error text; assert it names a file, a field and a command. Evidence:
   the full set of error messages in one table.
3. **Destination strength.** For each of `argCountAtMost`, `stdinBytesAtMost` and a policy `budget`,
   seed an `allow` rule over an `irreversible-outward` verb constrained only by that predicate. Assert
   `check` fails each one — a body-size cap constrains nothing about who receives the effect.
4. **Origins.** Seed one recipe per rejection class (userinfo, path, query, fragment, `http` scheme, IP
   literal). Assert `check` rejects each. Then edit a deployed recipe's origin and assert
   `diff --recipe` exits non-zero even with an unchanged `why`.
5. **Dry runs.** Run `simulate` for one `cli` and one `http` verb; capture golden output and assert it
   shows the verdict, the matched rule, the remedy, the would-be rendering and the exact brief, with no
   credential bound. Run an explain-only session of 50 invocations; assert zero `credential.bound`,
   zero `execution.started`, zero `approver.consulted`, and exactly 50 `explain.answered`.
6. **Trials.** Edit one rule; run `test` and assert the failure names that rule and the moved case. Run
   `test --update` and assert the diff shows observed verdicts and reasons. Take a real denial's
   `requestId`, run `trial add --from`, assert the new trial is red; make the intended edit, assert it
   is green.
7. **Budgets across restart.** Exhaust an hourly budget, tear the session down, start a new session
   against the same instance, invoke. Assert `budget-exhausted` and zero `execution.started`.
8. **Deploy is the only path.** Edit each artifact class in place while the auth process runs; assert
   no verdict changes. Then run `deploy` with one gate seeded to fail; assert nothing materializes and
   the running configuration is byte-identical to before.
