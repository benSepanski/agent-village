# M2: Containment at both boundaries — the filesystem and the wire

Spec: `../spec.md`
Status: Planned
Depends on: M1

## Slice

Two boundaries where bytes cross, made to hold.

**The filesystem.** `gh issue comment 412 --body-file ./notes/draft.md` resolves its path argument
beneath the workspace, refusing every symlink at every component, copies the file into a fresh staging
directory and digests it **before** the policy evaluates, rebuilds argv to point at the copy, runs
`gh` with an environment constructed wholly from the recipe and `HOME`/`XDG_*` pointed at a config root
outside the workspace, moves declared outputs back only after scanning them for the credential's exact
bytes, and dies with its shim.

**The wire.** The `http` emitter is built and proven against a **local capture server**, with no
credential, no provider, and no network: request-target construction from a segment array, R3's
universal segment rejections, pair-wise query encoding, `content-type` derived from `body.kind`,
literal parity with bound values, redirect refusal, and the full escape corpus — all asserted on the
**bytes the capture server observed**, never on the rendering's intent.

Those two live in one milestone because they are the same claim — that the bytes the policy inspected
are the bytes the target receives — checked on the two different channels it has to hold on.

## Out of scope

| Not here                                               | Where instead |
| ------------------------------------------------------ | ------------- |
| A real `http` origin, credential, or provider          | M4            |
| The full `check` gate set and the frozen policy schema | M3            |
| The second `gh` policy                                 | M3            |
| Credential-origin binding at runtime                   | M4            |
| Drift, retention enforcement, `observe`                | M5            |

## Acceptance criteria

| ID      | Criterion                                                                                                                                                                                                                                                                                                                                                   | Serves         | Verified by                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| AC-M2.1 | After 500 mixed invocations, a scan of the sandbox filesystem, every process environment, every argv and every returned stream finds zero occurrences of credential material                                                                                                                                                                                | AC-2.1         | Credential scanner, with an explicit `.git/config` assertion after a clone-shaped verb                          |
| AC-M2.2 | Neither the sandbox environment nor files planted in the workspace influence the target's configuration                                                                                                                                                                                                                                                     | AC-2.3         | Probe target printing its environ and config search path; planted `.netrc`, `.gitconfig`, `hosts.yml`, `curlrc` |
| AC-M2.3 | Path resolution refuses `..`, a symlink at every component, a hardlink, a bind mount, and a racing directory swap                                                                                                                                                                                                                                           | AC-2.4         | Escape suite, one case per class                                                                                |
| AC-M2.4 | The staged digest equals what the target opened, under 1,000 trials rewriting the workspace file during the verdict window; a post-verdict stdin write is refused                                                                                                                                                                                           | AC-2.4         | Race harness                                                                                                    |
| AC-M2.5 | Both deadlines are finite and terminate at process-group level, and a shim disconnect kills the child                                                                                                                                                                                                                                                       | AC-1.3         | Fault injection with `ps` showing zero surviving descendants                                                    |
| AC-M2.6 | An `email` argument containing a comma, angle brackets, a display name, whitespace or a control byte is refused before policy, and `argDomainIn` matches only the validated domain part                                                                                                                                                                     | AC-2.7         | Type-conformance corpus against a **seeded fixture**, since no shipped recipe has an `email` argument (Q14)     |
| AC-M2.7 | For every bound and literal position, each of `..`, `.`, `%2e%2e`, `%2E%2E`, `.%2e`, `/`, `%2F`, `\`, the empty string, CR, LF, `&`, `=`, `#`, `?`, an absolute URL and a `//host` prefix produces either a denial with a reason code or a request whose observed origin, segment count, request-target bytes and header set equal the recipe's declaration | AC-2.8         | The local capture server, asserting the request line and raw header block it received                           |
| AC-M2.8 | A 3xx response is refused rather than followed, and an `http` execution exits 0 on 2xx and 1 on every other status                                                                                                                                                                                                                                          | AC-1.4, AC-2.8 | Capture server returning one seeded response per status class                                                   |
| AC-M2.9 | `fetch`, `new URL`, and `URL.prototype.pathname` assignment anywhere in the request pipeline fail the build                                                                                                                                                                                                                                                 | AC-7.4         | The `no-url-parse-on-request-path` lint, with a seeded fixture                                                  |

## Audit surface

**Adds:** `path.staged`, `path.rejected`, `output.rejected`, and the `http` arm of
`execution.started` (`origin`, `method`, `segmentCount` in place of `pid`).

**Principal and correlation:** unchanged from M1, plus `stagingId` — which snapshot's bytes an
execution actually read. This is the identifier that makes "the bytes the policy inspected are the
bytes the target read" checkable after the fact rather than merely asserted.

**Never recorded:** workspace file contents. `path.staged` carries the argument name, a byte count and
a digest; the recorder never opens the copy. Response headers are never read into any typed path.
Reason codes new here — `path-escape`, `segment-refused`, `request-target-oversize`,
`redirect-refused`, `origin-address-refused`, `credential-in-output` — are members of the spec's closed
set, not free-form strings.

## Approach

Do the filesystem side first: it extends M1's path and its failure modes are familiar. Then the
emitter, which is new code with a new failure mode.

The emitter is deliberately built against a **local capture server**, so the riskiest new question —
do the bytes on the wire match what the emitter intended? — is answered with no credential, no
provider and no network. That is the whole reason `http` is split across M2 and M4 rather than landing
whole in M4.

What could go wrong:

- **The platform's URL machinery silently rewrites the request-target.** This is not hypothetical: on
  the pinned runtime, the WHATWG parser collapses percent-encoded dot segments and resolves
  protocol-relative references, which is why
  [ADR-0004](../../../adr/0004-typescript-node-for-agent-cli.md) rejects `fetch` outright. Any code
  path that reaches for a URL type reintroduces it, and no artifact on disk would be wrong.
- **Asserting intent instead of bytes.** A test that inspects the emitter's own output structure will
  pass while the wire disagrees. AC-M2.7 is worded around observed bytes for exactly this reason.
- **TOCTOU on the portable resolver.** A directory component swapped between two syscalls is a real
  residual, named in G10's Assumes. It narrows or closes depending on Q2.

## Decisions needed

- **Open question Q2** must be answered before this milestone finishes, because it decides whether
  G10 ships at its full or weakened strength, and whether
  [ADR-0004](../../../adr/0004-typescript-node-for-agent-cli.md) takes its reserved second dependency.
- **Open question Q16** — whether a runtime or HTTP-client minor-version bump gates on re-running
  AC-M2.7 — becomes answerable here, because this is where the corpus exists. If the answer is no, the
  spec should say G7's `http` clause is guidance rather than a rule.

## Verification

```bash
pnpm check
agent-cli check && agent-cli test && agent-cli deploy
```

1. **Staging.** Invoke `gh issue comment` with `--body-file`. Assert the child's cwd is the staging
   directory, the argv points at the copy, and `path.staged`'s digest equals the file's. Evidence: the
   record and a hash of both files.
2. **Race.** Run the 1,000-trial harness rewriting the workspace file during the verdict window.
   Assert the digest the target read equals the one the policy saw, every time. Evidence: the failure
   count, which must be zero, and the harness output.
3. **Escape suite.** One case per class — `..`, a symlink at each component depth, a hardlink, a bind
   mount, a racing directory swap. Assert `path-escape` before policy, and that the message names the
   parameter and **not** the resolved path.
4. **Environment.** Run the probe target with arbitrary variables set in the sandbox. Assert the
   printed environment equals the recipe's declaration exactly. Plant `.netrc`, `.gitconfig`,
   `hosts.yml` and `curlrc` in the workspace; assert nothing changes.
5. **Credential scan.** 500 mixed invocations including a clone-shaped verb, then scan the sandbox
   filesystem, the moved-back outputs, process environments, argv and returned streams. Assert zero
   occurrences. Evidence: the scanner report.
6. **Wire corpus.** Start the capture server. For every bound and literal position of the `http`
   recipe, emit the full escape corpus. For each case assert either a denial with a reason code, or
   that the captured request line and raw header block match the recipe's declaration exactly.
   Evidence: the captured bytes per case, not a summary.
7. **Redirects and status.** Capture server returns 301, 302, 200, 204, 400, 401, 429, 500. Assert no
   redirect is followed, exit 0 only on 2xx, exit 1 otherwise, `stderrBytes` is 0, and no agent-cli
   authored byte appears on either stream.
