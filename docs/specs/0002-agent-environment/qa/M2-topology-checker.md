# QA: M2 Topology checker

Milestone: `../milestones/M2-topology-checker.md`
Date: 2026-08-05
Verdict: Pass with follow-ups

## What was exercised

- `pnpm check` from the repo root — green, exit 0.
- `pnpm fixture:m2` in `packages/agent-environment` — every rejection fixture, the `allow-all`
  fixture, and the M1 valid fixture through `declareTopologyFile`, with per-criterion output and
  journal inspection. All checks pass, exit 0.
- `pnpm fixture:m1` in the same package, live against a Docker daemon (dockerd started by the
  SessionStart hook) — all six AC-M1 criteria pass on the migrated schema, confirming the checker
  admits and starts what the spec permits (verification step 4).
- Fourteen hostile topologies the fixtures do not cover, fed to `checkTopology` directly: writes
  smuggled through mount **mode** rather than role, violations expressed through bridges instead of
  mounts, a volume named `Journal`, same-environment duplicate writer mounts, an empty-string
  subtree, a writer mount of the journal, an array root, a JSON body carrying `__proto__`, an
  `allow-all` network bridge, and a many-rules-at-once topology.

## Criteria

| ID      | Result | Evidence                                                                                                                                                                                                                                                     |
| ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-M2.1 | Met    | Both two-writers fixtures rejected `volume-has-multiple-writers` naming `ledger`; detail lists the writer environments. Finding 1 (below) showed the same violation expressed via mount mode was missed; fixed this pass, third variant fixture now rejected |
| AC-M2.2 | Met    | `writer-mount.json` and `reader-mount-read-write.json` rejected `mediated-volume-mounted-read-write` naming `memory`/`assistant`                                                                                                                             |
| AC-M2.3 | Met    | Both journal-mount fixtures rejected `journal-mounted-into-agent-environment` naming `assistant`; the agentless co-reader in the second fixture is not named, and a journal read-only mount in an agentless environment is accepted (unit test)              |
| AC-M2.4 | Met    | Two credential-volume fixtures rejected `credential-volume-outside-credential-environment` (naming `vault-keys` and the offending environment); two credential-environment fixtures rejected `credential-environment-mounts-foreign-written-volume`          |
| AC-M2.5 | Met    | Both missing-subtree fixtures (absent key, explicit `null`) rejected `mount-missing-subtree` naming `scratch`/`searcher`                                                                                                                                     |
| AC-M2.6 | Met    | `allow-all` fixture accepted; checker output reports `unmediated-write-path` naming bridge `memory-write`, volume `memory`, request type `memory.append`; the same finding observed on the `topology.declared` journal event                                 |
| AC-M2.7 | Met    | Every rejection fixture's journal carries `topology.rejected` with the expected reason and a detail string, and no `instance.started` event follows — checked per fixture by the runner                                                                      |

## Audit check

| Promised event      | Observed                                                                                                                                                                                                                                                                          | Principal attributable | Retention bound honoured                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------- |
| `topology.rejected` | Yes — one per violated rule, e.g. `{"event":"topology.rejected","principal":{"kind":"runtime"},"reason":"volume-has-multiple-writers","detail":"volume ledger declares 2 writer environments: sweeper, checker-in","volume":"ledger",...}` with digest of the refused declaration | Yes — `runtime`        | N/A — content store and retention are M8 (per M1) |
| `topology.declared` | Yes — carries the topology digest, application, and the surfaced `unmediated-write-path` finding                                                                                                                                                                                  | Yes — `owner`          | N/A — as above                                    |

The denial path is the milestone's subject: every rejection was observed in the journal with a
closed-enum reason, the offending element, and no start event. A record read alone reconstructs
what was declared (digest), who refused it (`runtime`), which rule, and which element. Volume
contents are nowhere recorded, as the milestone requires.

## Findings

| #   | Severity | Finding                                                                                                                                                                                                                                                                              | Breaks                                                                                                                        | Disposition                                                                                                                                                                         |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | High     | A `reader`-role mount with mode `read-write` was accepted — including alongside a declared writer, i.e. a second kernel-level write path on one volume that the role-based writer count missed. The milestone's own approach section predicted this failure shape                    | The declaration-time premise of the spec's "no volume has two concurrent writers" guarantee (AC-1.1), and lease scoping in M4 | **Fixed this pass**: `mount-role-mode-mismatch` rule (mode must be what the role declares), writer count now includes read-write-mode mounts, fixture variants and unit tests added |
| 2   | Medium   | Spec finding: AC-1.4's "a volume another environment writes" counts mount writers only. A credential-holding environment may mount a mediated volume that a foreign environment writes via a mediated-write bridge — the data path the rule exists to close, re-opened via crossings | Nothing the spec states; arguably the intent of the credential-environment rule                                               | Owner ruling: should "writes" include mediated-write bridge paths? Recommend yes, by spec amendment; checker change is small either way                                             |
| 3   | Medium   | Spec finding: a bridge from a non-credential-holding environment may target a credential-class mediated volume. Credential-class rules govern mounts only, so an outsider can hold a write path into a credential store                                                              | Nothing the spec states; the credential-class label's reach                                                                   | Owner ruling recorded here and in `docs/ai/`; does not block M3                                                                                                                     |
| 4   | Low      | Spec finding: `allow-all` on a **network** bridge is accepted with no surfaced finding — the spec asks surfacing only for mediated-write bridges, but an allow-all network egress is at least as weak a spot                                                                         | Nothing stated; symmetry of AC-1.6's "cannot pass silently"                                                                   | Owner ruling; a one-rule addition if wanted                                                                                                                                         |
| 5   | Low      | Spec finding: two bridges from different environments may write one mediated volume. Likely intended (every change is still a recorded crossing), but the spec never says so                                                                                                         | Nothing stated                                                                                                                | Owner confirmation; no change recommended                                                                                                                                           |
| 6   | Low      | The milestone doc contradicts itself: "Out of scope" defers the `topology.declared` half of AC-1.6 to M5, while its own audit surface says `topology.declared` now carries the checker's findings — which is what was built and what AC-M2.6's runner checks                         | Doc coherence only; the built direction is the stronger one                                                                   | Recorded here; milestone docs are not retro-edited. M5 should treat that half as already done                                                                                       |

## Not covered

- **Runtime enforcement** of anything the checker admits — mounts, modes, subtrees, pinning. That is
  M3/M5 by the milestone's own scope; this pass checked declarations only.
- **Concurrent declaration.** No concurrent path exists yet — one process declares before anything
  runs — so concurrency attacks have nothing to race.
- **Oversized declarations.** The checker reads the whole file synchronously; no size bound exists.
  Declarations are owner-authored, not hostile input, so this is noted rather than pressed.
- **Reconstruction from one flow identifier** across stores — M8's criterion, not exercised here.

## Verdict

**Pass with follow-ups.** Every AC-M2 criterion was observed met by rerunning the milestone's
verification exactly as written, plus a live M1 run over Docker. The one real defect found — write
access smuggled through mount mode (finding 1) — was fixed and fixture-covered in this pass, so the
checker now refuses it with a named reason like every other rule. Follow-ups and their homes:
findings 2–5 are spec findings awaiting owner rulings, recorded here and flagged in
`docs/ai/2026-08-05-qa-m2.md`; finding 6 is recorded here for M5's executor. None block M3.
