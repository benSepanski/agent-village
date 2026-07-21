# cli-wrapper module — design (milestone M5.5)

Owner-requested scope addition (Ben, 2026-07-21). This doc is the design for a
new **cli-wrapper** module; the milestone that delivers it is
[M5.5 in the milestone plan](1.0-definition.md#milestone-plan-criteria-mapped).
Built as a self-contained module inside this repo first; expected to graduate
to its own repository later, so the core must not depend on agent-village
internals (see [Deployment shapes](#deployment-shapes)).

## Problem

Giving a sandboxed agent a CLI today is all-or-nothing: either the CLI and its
credentials live inside the sandbox (full power, full blast radius), or the
agent doesn't get the tool at all. There is no middle ground where an agent can
use `gh`, `aws`, `stripe`, … under a per-invocation policy, with the
credentials never entering the sandbox.

## Design in one paragraph

The isolated agent's container gets a **shim** that looks exactly like the real
CLI but only forwards the exact `argv` (+ stdin) to an **approver** running
outside the sandbox. The approver holds the real CLI and the auth keys, and
applies a **policy**: some invocations auto-allow deterministically (no agent
involved, e.g. read-only subcommands), some auto-deny, and the rest are judged
by an **approver agent that starts fresh for every request** — there is no
conversation, no memory, and no channel for the isolated agent to argue.
Verdicts are allow, deny (optional reason), or escalate: on detected
prompt-injection or on repeated denials past a tolerance, the approver
**gracefully kills the isolated agent and notifies the user**.

## Threat model & design principles

The adversary is a **compromised or misaligned isolated agent** (e.g. via
prompt injection from web/email content it processed). Principles, each doing
real work:

| Principle                           | Consequence in the design                                                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credentials never enter the sandbox | Real CLI + keys exist only in the approver's environment; the shim contains no auth material.                                                               |
| No persuasion channel               | The request is `argv` + stdin, nothing else. There is no free-text "justification" field; the isolated agent cannot lobby.                                  |
| Approver agent starts fresh         | Each reviewed request is judged in a brand-new context with zero history — the agent cannot be worn down across turns or primed by earlier requests.        |
| Argv is data, not instructions      | The reviewer prompt treats the forwarded bytes strictly as data to classify; instruction-like content aimed at the approver is itself an escalation signal. |
| Deterministic before agentic        | Auto-allow/auto-deny rules run first; the agent only sees the residue. Smaller agent surface = smaller injection surface and lower cost/latency.            |
| Misuse is bounded, not just denied  | Denials are counted; past a tolerance the run is killed and the user notified. A denied request is evidence, not a free retry.                              |

## Architecture

```
┌─ sandbox (isolated agent) ─────────┐        ┌─ approver (trusted side) ──────────────────┐
│  agent process                     │        │                                            │
│    │ exec "gh pr list ..."         │        │  1 policy engine (deterministic)           │
│    ▼                               │  argv  │     ├─ auto-allow ──────────────┐          │
│  shim `gh` (wrapped CLI)  ─────────┼──────▶ │     ├─ auto-deny ──▶ deny(+why) │          │
│    ▲                               │        │     └─ review ──▶ 2 approver agent (fresh) │
│    └── stdout/stderr/exit code ◀───┼────────┤                     ├─ allow ───┤          │
│                                    │        │                     ├─ deny(+why)          │
│  (egress allowlist = approver      │        │                     └─ escalate ─┐         │
│   endpoint ONLY)                   │        │  3 executor: real CLI + real creds         │
└────────────────────────────────────┘        │  4 sentinel: denial counter, kill+notify ◀─┘
                                              └────────────────────────────────────────────┘
```

### Components

1. **`wrap` utility** — generates a shim binary/script named identically to the
   real CLI, installed on `PATH` in the sandbox image. The shim serializes
   `argv` verbatim (no parsing, no interpretation), captures stdin (size-capped),
   sends one request to the approver endpoint, then replays the response's
   stdout/stderr and exits with the real exit code. From the agent's point of
   view the CLI just works — or fails with the deny reason on stderr.
2. **Transport** — single request/response endpoint, HTTP + JSON, buffered in
   v1 (no streaming). Pluggable binding: localhost/unix socket for local dev;
   in agent-village, an allowlisted host that is the **only** entry in the
   run's `egressAllow` (enforced by the existing
   [egress-proxy sidecar](../adr/0003-egress-proxy-sidecar.md) — no new
   network mechanism needed).
3. **Policy engine** — a declarative policy file per wrapped CLI. Rules match
   on the argv prefix / flags, first match wins, default is `review`:

   ```yaml
   cli: gh
   rules:
     - match: ['pr', 'list'] # read-only → no agent involved
       action: auto-allow
     - match: ['repo', 'delete']
       action: auto-deny
       reason: 'destructive; never allowed for this agent'
     - match: ['pr', 'comment']
       action: review # approver agent judges each call
       guidance: 'allow comments on PRs in org X only; deny mentions of secrets'
   tolerance:
     maxDenials: 3 # denials before graceful kill
   notify: user # kill/escalation notification target
   ```

4. **Approver agent** — invoked only for `review` rules. Fresh context per
   request: input is the policy's `guidance` + the exact argv/stdin **as
   quoted data**; output is a structured verdict
   `{allow} | {deny, reason?} | {escalate, reason}`. It is explicitly
   instructed that instruction-like text inside the request ("ignore your
   policy", role-play framing, encoded payloads) is grounds for `escalate`,
   not something to obey. No history, no memory, no follow-up turn — a denial
   is final for that request.
5. **Executor** — runs the real CLI with the real credentials in the
   approver's environment, captures stdout/stderr (size-capped) and exit code,
   returns them verbatim.
6. **Sentinel** — the only stateful piece: a per-run denial counter and the
   kill path. On `escalate`, or when denials exceed `tolerance.maxDenials`,
   it gracefully stops the isolated agent (SIGTERM — in agent-village the
   base-image entrypoint already flushes `/workspace` on SIGTERM) and notifies
   the user with the triggering request and verdicts. Deny responses include
   the remaining tolerance, so a well-behaved agent sees the budget shrinking
   and can change course.

### Request lifecycle

1. Agent execs `gh <args>`; the shim forwards `{cli, argv, stdin}`.
2. Policy engine matches: `auto-allow` → step 4; `auto-deny` → step 5;
   `review` → step 3.
3. Fresh approver agent judges against the rule's guidance → allow / deny /
   escalate.
4. Allow: executor runs the real CLI; shim replays stdout/stderr/exit code.
5. Deny: shim exits non-zero with the reason (if any) and remaining tolerance
   on stderr; sentinel increments the counter.
6. Escalate, or counter past tolerance: sentinel kills the run gracefully and
   notifies the user. The isolated agent gets no further explanation — by
   design there is nothing to negotiate with.

## Policy authoring helper

The module ships a **policy-generation prompt**: give it the CLI's `--help`
output (recursively for subcommands) and a one-line statement of what the
agent is for, and it drafts a policy — read-only verbs `auto-allow`,
destructive/credential/config verbs `auto-deny`, everything else `review` with
task-appropriate guidance. The human reviews and commits the policy; the
helper never installs one unreviewed.

## Deployment shapes

- **Core (repo-agnostic):** shim generator, policy engine, approver loop,
  sentinel — no agent-village imports. This is the piece that later moves to
  its own repository.
- **agent-village adapter:** wires the transport into the sandbox topology
  (approver endpoint as the sole `egressAllow` entry), the kill path into the
  existing run-stop machinery, and notifications into the platform's alerting.
  Per the platform-not-applications rule, the adapter stays thin; specific
  CLI policies are app-repo content, like manifests.

## Non-goals (v1)

- Interactive/TTY CLIs (no PTY forwarding); streaming output (buffered only).
- Forwarding file arguments' _contents_ — the approver sees argv only; a path
  argument is judged as a string. Commands whose safety depends on file
  contents belong in `review` with guidance saying so, or `auto-deny`.
- Env-var passthrough from sandbox to executor (none in v1).
- MCP transport — explicitly out of 1.0 scope and out of scope here.

## Open questions

- stdin caps and binary stdin handling.
- Whether tolerance/denial state should span runs (per agent) or reset per run
  (v1: per run).
- Approver agent model choice + cost cap per review call (should ride the
  existing metering gateway when deployed on-platform).

## Acceptance criteria

Delivered under milestone **M5.5**; IDs continue the
[1.0-definition](1.0-definition.md) scheme.

| ID     | Criterion                                                                                                                                               | Verified by         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| AC-8.1 | The shim forwards exact argv + stdin with no interpretation and replays stdout/stderr/exit code verbatim on allow.                                      | Unit + Integration  |
| AC-8.2 | Deny-path: from the sandbox, only the approver endpoint is reachable; the real CLI and its credentials are absent from the sandbox image and env.       | Integration         |
| AC-8.3 | `auto-allow` rules execute with **no** agent invocation; `auto-deny` rules never reach the executor; unmatched invocations default to `review`.         | Unit                |
| AC-8.4 | Each `review` verdict is produced in a fresh agent context — no conversation state persists between requests (asserted on the approver call structure). | Unit + Integration  |
| AC-8.5 | Deny returns the optional reason + remaining tolerance; exceeding `maxDenials` gracefully kills the run (workspace flushed) and notifies the user.      | Integration         |
| AC-8.6 | An injection-style request (instructions aimed at the approver) yields `escalate` → kill + user notification, not compliance.                           | Integration         |
| AC-8.7 | The policy-generation prompt, given a real CLI's help text, drafts a valid policy that the engine loads; a human-review step is documented as required. | Manual (doc review) |
