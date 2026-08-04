# github — a `cli` target

The flagship worked example: the real `gh` binary, a fine-grained repo-scoped personal access token in
the child environment, and two policies over one recipe. It exists to show that a **partial grammar is
sound** — the recipe models three of `gh`'s hundreds of commands, and everything it does not model is
unreachable rather than merely forbidden.

Shipped. Its artifacts are named in AC-7.1, and it is what M1 through M3 build.

## The recipe

`recipes/github.recipe.json`. Says what is _possible_, never what is permitted.

```json
{
  "$schema": "../schemas/recipe.json",
  "name": "github",
  "kind": "cli",
  "target": { "exec": "gh", "version": "2.63.2" },
  "credential": { "kind": "token", "boundVia": "env", "envName": "GH_TOKEN" },
  "configRoot": "/var/lib/agent-cli/config/github",
  "concurrency": { "key": "credential", "max": 4, "queueMaxMs": 5000 },
  "neverModel": ["--hostname", "--template", "--config", "--jq", "api"],
  "limits": { "stdinMaxBytes": 65536, "stdoutMaxBytes": 4194304, "execMs": 30000 },
  "verbs": [
    {
      "name": "issue.list",
      "match": ["issue", "list"],
      "effect": "read",
      "args": [
        {
          "name": "repo",
          "flag": "--repo",
          "type": "string",
          "pattern": "^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$",
          "required": true
        },
        { "name": "limit", "flag": "--limit", "type": "int", "min": 1, "max": 100 },
        { "name": "state", "flag": "--state", "type": "enum", "values": ["open", "closed", "all"] }
      ]
    },
    {
      "name": "issue.view",
      "match": ["issue", "view"],
      "effect": "read",
      "args": [
        { "name": "number", "type": "int", "positional": true, "required": true },
        {
          "name": "repo",
          "flag": "--repo",
          "type": "string",
          "pattern": "^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$",
          "required": true
        },
        { "name": "comments", "flag": "--comments", "type": "bool" }
      ]
    },
    {
      "name": "issue.comment",
      "match": ["issue", "comment"],
      "effect": "remote-write",
      "destination": ["repo", "number"],
      "args": [
        { "name": "number", "type": "int", "positional": true, "required": true },
        {
          "name": "repo",
          "flag": "--repo",
          "type": "string",
          "pattern": "^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$",
          "required": true
        },
        {
          "name": "bodyFile",
          "flag": "--body-file",
          "type": "workspace-path",
          "mode": "read",
          "maxBytes": 65536,
          "required": true
        }
      ]
    },
    {
      "name": "repo.clone",
      "match": ["repo", "clone"],
      "effect": "local-write",
      "args": [
        {
          "name": "repo",
          "type": "string",
          "positional": true,
          "pattern": "^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$",
          "required": true
        },
        {
          "name": "into",
          "type": "workspace-path",
          "mode": "create",
          "positional": true,
          "required": true
        }
      ],
      "outputs": ["into"]
    }
  ]
}
```

Four fields carry most of the weight, and an author who skips them ships something unsafe that still
runs:

- **`configRoot`** is where `HOME` and every `XDG_*` point, outside the workspace. Without it a
  `.gitconfig` the agent writes into the shared mount is read by a credentialed process (G8).
- **`neverModel`** names tokens a recipe may never model. `api` is there because `gh api` is a general
  HTTP client, which is a stated non-goal; `--jq` and `--template` because they are expression
  languages inside an argument.
- **`concurrency.key: "credential"`** and not `"wrap"` — two wraps sharing one token must share one
  lock, or a refresh corrupts an in-flight call (G15).
- **`destination`** on `issue.comment`, because it is `remote-write`. `check` fails any `allow` or
  `ask` rule leaving `repo` or `number` unconstrained (G11).

## The surface map

`recipes/github.surface.json` is **inventory, not a to-do list**. It records what `help-walk` observed,
so `doctor` can later re-run the same walk and diff it. The recipe models 4 of the 91 commands it found,
and that is a complete, sound recipe.

```json
{
  "target": "gh",
  "observedVersion": "2.63.2",
  "capturedAt": "2026-08-02",
  "digest": "sha256:9f2c…",
  "commands": [
    {
      "path": ["issue", "list"],
      "flags": ["--repo", "--limit", "--state", "--label", "--assignee", "--json"]
    },
    { "path": ["issue", "view"], "flags": ["--repo", "--comments", "--json"] },
    { "path": ["issue", "comment"], "flags": ["--repo", "--body", "--body-file", "--editor"] },
    { "path": ["pr", "merge"], "flags": ["--squash", "--merge", "--rebase", "--delete-branch"] }
  ]
}
```

`pr merge` is in the map and not in the recipe. An agent invoking it gets `unmapped-verb` at exit 77,
and `doctor` lists it in the ranked "modelled 4 of 91" report — which is how an unmet need becomes
visible without ever having been reachable.

## The two policies

`policies/github-readonly.policy.json`:

```json
{
  "$schema": "../schemas/policy.json",
  "name": "github-readonly",
  "recipe": "github",
  "intent": "Let a digest agent read issues in repositories this instance owns. It never writes.",
  "default": "deny",
  "budget": { "perHour": 200 },
  "rules": [
    {
      "id": "R1",
      "when": { "verbIn": ["issue.list", "issue.view"], "argGlob": { "repo": "agent-village/*" } },
      "action": "allow",
      "why": "Reading our own issues is the whole job, and reading cannot be undone wrongly."
    }
  ]
}
```

`policies/github-comment.policy.json` — **the second policy over the same recipe**, which is the DG2
demonstration. No recipe edit, no surface map edit, no shim change:

```json
{
  "$schema": "../schemas/policy.json",
  "name": "github-comment",
  "recipe": "github",
  "intent": "Let the triage agent read issues and reply on them, in one repository only.",
  "default": "deny",
  "budget": { "perHour": 200, "perVerb": { "issue.comment": 20 } },
  "rules": [
    {
      "id": "R1",
      "when": {
        "verb": "issue.comment",
        "argEquals": { "repo": "agent-village/agent-village" },
        "argCountAtMost": { "bodyFile": 1 }
      },
      "action": "allow",
      "why": "Triage replies belong on our own tracker. One repository, so a wrong repo argument is a denial rather than a public comment somewhere else."
    },
    {
      "id": "R2",
      "when": { "verbIn": ["issue.list", "issue.view"], "argGlob": { "repo": "agent-village/*" } },
      "action": "allow",
      "why": "Reading is a precondition for replying sensibly."
    }
  ]
}
```

`R1` satisfies G11 because `repo` — a declared destination — is constrained by `argEquals`. Replacing
that with only `argCountAtMost` would fail `check` with `destination-unconstrained`: a count bound says
nothing about **where** the comment lands.

## The wraps

```json
{
  "name": "github-readonly",
  "recipe": "github",
  "policy": "github-readonly",
  "credential": { "id": "gh-ro", "version": 3 },
  "command": "gh",
  "grants": ["inbox-digest"]
}
```

```json
{
  "name": "github-comment",
  "recipe": "github",
  "policy": "github-comment",
  "credential": { "id": "gh-triage", "version": 1 },
  "command": "gh",
  "grants": ["triage"]
}
```

Both take the command name `gh`, which is legal because they are granted to different sessions. Two
wraps in **one** grant directory may not share a name — a filesystem fact, refused rather than decided.

## The trials

`trials/github-comment.trials.json`. Runs offline, against a fixed clock, never calling a model.

```json
{
  "policy": "github-comment",
  "cases": [
    {
      "argv": ["issue", "list", "--repo", "agent-village/agent-village"],
      "expect": { "verdict": "allow", "rule": "R2" }
    },
    {
      "argv": [
        "issue",
        "comment",
        "412",
        "--repo",
        "agent-village/agent-village",
        "--body-file",
        "notes/draft.md"
      ],
      "expect": { "verdict": "allow", "rule": "R1" }
    },
    {
      "argv": [
        "issue",
        "comment",
        "1",
        "--repo",
        "someone-else/private",
        "--body-file",
        "notes/draft.md"
      ],
      "expect": { "verdict": "deny", "reason": "no-matching-rule" }
    },
    {
      "argv": ["pr", "merge", "412", "--squash"],
      "expect": { "verdict": "deny", "reason": "unmapped-verb" }
    },
    {
      "argv": ["issue", "list", "--repo", "agent-village/agent-village", "--jq", ".[]"],
      "expect": { "verdict": "deny", "reason": "unmapped-verb" }
    }
  ]
}
```

The last two are the interesting ones. Neither `pr merge` nor `--jq` is denied by a rule — there is no
rule about them. They are denied because nothing modelled them, and total match turns an unconsumed
token into a denial naming that token.

## What this strains

| Strain                                                         | What happens                                                                                                                                                                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gh` has ~91 commands and hundreds of flags                    | Nothing. The recipe models 4. Partial grammars are sound, so the cost of wrapping is proportional to what you use, not to what exists — this is the DG2 bet                                                                                |
| Abbreviations and aliases (`gh is list`, a user-defined alias) | Denied as `unmapped-verb`. `match` compares exact token sequences; the resolution a shell or `gh` itself would do never happens, because argv is rebuilt not forwarded                                                                     |
| A parent verb's `match` prefixing a child's                    | `check` refuses it unless the shorter declares `exact: true`. Longest match wins, so a write can never evaluate under a read verb's effect class                                                                                           |
| Flags that read local files (`--body-file`)                    | Typed `workspace-path`, resolved beneath the workspace with every symlink refused, staged and digested before policy runs                                                                                                                  |
| Flags that are expression languages (`--jq`, `--template`)     | In `neverModel`. `check` fails a recipe that models one                                                                                                                                                                                    |
| `gh api` — a general HTTP client wearing a subcommand          | A stated non-goal. Its path argument would be under the agent's control at invocation time, where it is unenumerable and passes through no gate                                                                                            |
| Effect classification                                          | **Unclosed.** `check` enforces that an effect is _stated_, not that it is true. Classify `issue.comment` as `read` and `destination` never fires, `argEquals` never applies, and G11 is defeated with no mechanical detector               |
| `gh` changes its flags upstream                                | `doctor` re-runs `help-walk` and diffs. A grammar change to a policy-referenced verb quarantines the wrap (G14). A flag that keeps its name and changes meaning is undetected — trials and the effect classification are the only defences |

## Criteria this example serves

AC-7.1 (both policies over one recipe, plus the `doctor` ranked list), AC-5.1 (the three-file
increment), AC-2.5 (unmodeled and forbidden tokens unreachable), AC-2.3 and AC-2.4 (config root and
staging, via `issue.comment --body-file`), AC-6.1 (drift classification against the surface map).
