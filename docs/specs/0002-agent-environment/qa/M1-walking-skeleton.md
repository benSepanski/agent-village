# QA: M1 Walking skeleton

Milestone: `../milestones/M1-walking-skeleton.md`
Date: 2026-08-04
Verdict: Pass with follow-ups

QA performed in a session that did not build M1, on `main` at `fcf46f5`, against a live Docker
daemon (29.3.1, Linux 6.18).

## What was exercised

1. `pnpm check` — green (format, links, typecheck, lint, 11 unit tests).
2. `pnpm --filter @agent-village/agent-environment fixture:m1` — a fresh run, not the implementer's.
   All six criteria printed PASS. Journal at `/tmp/agent-environment-m1-23fee4a1/journal.jsonl`,
   probe report at `probe-report.json` alongside it.
3. Independent journal inspection: parsed the JSONL directly and re-checked sequences, identifiers,
   and envelope fields without going through the fixture's own checker.
4. **Negative control** for the sweep: the identical TCP connect from `node:22-alpine` to a
   host-side listener at the Docker gateway (`172.17.0.1:9099`) run twice — once with
   `--network bridge`, once with `--network none`.
5. **Hostile pass at the bridge socket**: a standalone client against a live `Bridge` on the M1
   fixture topology sent garbage bytes (`\x00\xff{{{not json`), an unknown op
   (`{"op":"shutdown",...}`), an array payload, a payload with an extra field, and an envelope
   carrying a forged `principal: {"kind":"runtime"}` field.

## Criteria

| ID      | Result | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-M1.1 | Met    | Probe report: 7 attempts, all `failed` — `tcp4 1.1.1.1:80` and `tcp4 8.8.8.8:443` `ENETUNREACH`, `tcp6 [2606:4700:4700::1111]:80` `EAFNOSUPPORT`, `udp4 1.1.1.1:53` `ENETUNREACH`, system-resolver lookup timeout, resolve via `8.8.8.8` and via Docker embedded `127.0.0.11` both `ECONNREFUSED`. Negative control: same connect code under `--network bridge` printed `REACHED-NETWORK: tcp connect succeeded`; under `--network none`, `ENETUNREACH` — the sweep's detection arm works, and the denial is the namespace, not the environment |
| AC-M1.2 | Met    | Journal seq 4–6: `crossing.requested` → `crossing.decided` (`verdict: allow`, `decider: program`) → `crossing.performed`, all `crossing: "x-1"`, shared `request_digest`, `result_digest` on performed                                                                                                                                                                                                                                                                                                                                          |
| AC-M1.3 | Met    | Journal seq 8: `crossing.decided` `{crossing: "x-2", verdict: "deny", reason: "payload-size-exceeded", decider: "program"}` — reason is a `DENY_REASONS` member                                                                                                                                                                                                                                                                                                                                                                                 |
| AC-M1.4 | Met    | Journal seq 9–10: `probe.forbidden` → `crossing.decided` `{verdict: "deny", reason: "request-type-undeclared"}`; no `crossing.performed` for `x-3` anywhere in the journal                                                                                                                                                                                                                                                                                                                                                                      |
| AC-M1.5 | Met    | Probe's filesystem walk from `/` (depth 6) found zero journal-named paths; `/bridge` contains only `bridge.sock`. The captured mount table shows the only host mounts are `/bridge` (rw), `/app` (ro), and Docker's `/etc/{resolv.conf,hostname,hosts}` — the journal lives in the host run directory, whose parent is not mounted, so no environment-writable path feeds it                                                                                                                                                                    |
| AC-M1.6 | Met    | Independent parse: 11 events, every name in the 7-name closed set (itself a subset of the spec's Audit surface tables), every record carrying `application_instance`, `activation`, `flow`, `principal`, and `turn` (null on platform lifecycle events, as documented)                                                                                                                                                                                                                                                                          |

## Audit check

| Promised event       | Observed                      | Principal attributable                       | Retention bound honoured                             |
| -------------------- | ----------------------------- | -------------------------------------------- | ---------------------------------------------------- |
| `topology.declared`  | seq 1, with `topology_digest` | `runtime`                                    | n/a — M8 owns bounds; M1 records digests, not bodies |
| `instance.started`   | seq 2, with container id      | `runtime`                                    | same                                                 |
| `activation.started` | seq 3                         | `runtime`                                    | same                                                 |
| `crossing.requested` | seq 4, 7, 9                   | `agent-instance` with the four-part identity | payload as `request_digest` only — observed          |
| `crossing.decided`   | seq 5 (allow), 8, 10 (deny)   | `bridge` (`probe-egress`)                    | same                                                 |
| `crossing.performed` | seq 6                         | `bridge`                                     | result as `result_digest` only — observed            |
| `activation.ended`   | seq 11, `outcome: completed`  | `runtime`                                    | same                                                 |

The denial path is recorded (seq 8 and 10 above). In the hostile pass every one of the five
attacks produced journal records — 12 events, none silent — and the forged `principal` field in the
envelope was ignored: the journal's principal is stamped platform-side in every record.

## Findings

| #   | Severity | Finding                                                                                                                                                                                                                               | Breaks                                                                                                                      | Disposition                                                                                                                 |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | Low      | The wire `op` field is never validated: `{"op":"shutdown",...}` is handled as an invoke and was allowed (hostile pass, crossing `x-2`). `InvokeRequest` declares `op: 'invoke'` but `handleLine` passes any parsed object to `invoke` | No M1 criterion — the crossing was still declared, policied, and journaled. But an untrusted wire field is silently coerced | Recorded here; validate `op` explicitly when M2 lands the full refusal rules, denying unknown ops with a closed-enum reason |
| 2   | Note     | AC-M1.5's automated check is a name-heuristic (substring `journal`, depth ≤ 6). The load-bearing evidence is the captured mount table, which QA read directly                                                                         | Nothing today                                                                                                               | None needed; noted so a future rename of the journal file doesn't quietly vacuate the scan                                  |
| 3   | Note     | `/bridge` is a read-write host directory mount, so the environment can create arbitrary files in the channel directory (e.g. disk exhaustion)                                                                                         | Nothing in M1's criteria                                                                                                    | M3 owns volumes and mounts; revisit the channel mount's write policy there                                                  |

Nothing found violates a milestone criterion or the spec. No scope creep found: no volume classes,
wakeups, ingress, taint, or content store exist in the package; the flow is the documented
placeholder. Terminology matches the spec's words (crossing, activation, flow, principal, bridge,
environment; `Envelope` is used for the journal record's stamped frame, which M1's milestone doc
itself does — watch that it stays distinct from spec 0002's ingress "envelope" when M6 lands).

## Not covered

- **Concurrency and interruption**: one probe, one turn, sequential crossings. Simultaneous
  connections to the bridge socket and mid-flight interruption are untested — M4 owns turns and the
  write lease and is where that pressure belongs.
- **Journal durability under crash**: writes are `appendFileSync` before the action proceeds; no
  kill-mid-write test was run.
- **IPv6 UDP** was not attempted (IPv6 TCP and three DNS routes were); the kernel refused IPv6 at
  the socket layer (`EAFNOSUPPORT`), which covers the family.
- **Image provenance**: the fixture pulls `node:22-alpine` by tag, not digest. Not an M1 criterion.

## Verdict

**Pass with follow-ups.** Every criterion was observed met on a fresh run, the sweep's detection arm
was proven live by the negative control, and the hostile pass left no silent path. Follow-ups:
finding 1 (validate `op`) is recorded above for M2's refusal-rules work; findings 2–3 are notes
homed at M2/M3. None blocks M2.
