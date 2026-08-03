# M5: Mediated volumes — pinned reads, crossed writes

Spec: `../spec.md`
Status: Planned
Depends on: M4

## Slice

A durable volume declared write-only-via-crossing behaves as the spec defines: readers get a
read-only mount pinned to a snapshot whose contents do not change while newer versions exist, and
the only way its contents ever change is a crossing to a bridge — carrying a digest, a principal, a
flow, and a verdict. Basis becomes real: every event from an environment mounting a mediated volume
carries the (volume, snapshot) pairs its mounts were pinned to. The `allow-all` policy class is
reported as an unmediated write path in `topology.declared`, completing AC-1.6's journal half. The
version-retention linkage is declared (each mediated volume names its finite bound) though its
enforcement at the journal is M8's.

## Out of scope

- Retention enforcement — write crossings outliving the general journal bound because their version
  is reachable is M8 (AC-4.2).
- A real memory-bridge policy vocabulary — the spec's open question on the smallest useful policy
  class set is resolved by the mail assistant's memory bridge in M9; M5 ships `allow-all` plus at
  least one decidable class (e.g. schema-checked structured writes) to prove the mechanism
  distinguishes them.
- Deferral of a mediated write — M7.

## Acceptance criteria

| ID      | Criterion                                                                                                                                                 | Serves | Verified by                                              |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------- |
| AC-M5.1 | A read-only mount of a mediated volume is pinned: its contents do not change while a newer version exists                                                 | AC-2.5 | Filesystem inspection during a concurrent write crossing |
| AC-M5.2 | Every write to a mediated volume appears as a crossing carrying a digest, principal, flow, and verdict; a direct write attempt from any environment fails | AC-3.1 | Journal inspection plus a direct-write attempt           |
| AC-M5.3 | A mediated-write bridge with policy class `allow-all` is reported as an unmediated write path in `topology.declared`                                      | AC-1.6 | Journal inspection                                       |
| AC-M5.4 | Every event from an environment mounting mediated volumes carries its basis, and a write crossing carries volume and version                              | AC-4.1 | Journal inspection                                       |
| AC-M5.5 | A write crossing under a decidable policy class (schema-checked) is denied on a violating payload, with reason and decider                                | AC-3.2 | Journal inspection                                       |

## Audit surface

Events: `crossing.*` for write crossings, `volume.digest` per new version, `volume.mounted` now
carrying the pinned snapshot. Principals: the requesting agent instance; `bridge` as performer.
Identifiers: volume and version on write crossings; `basis[]` on every event from a
mediated-mounting environment. Retention: write crossings are declared retained as long as their
version is reachable (bound named per volume, ceiling 400 days) — declaration here, enforcement
M8. Never recorded: reads from the pinned mount — the spec's first stated non-guarantee.

## Approach

Snapshot pinning on Docker: copy-on-publish is the simple honest shape — each accepted write
crossing produces a new immutable version directory, and readers bind-mount the version they were
pinned to at activation start. That satisfies "a runtime that bind-mounts read-write and reconciles
in the background does not satisfy this" by construction. What could go wrong: version storage
growth (bounded by the declared version-retention bound — deletion of expired versions can be
deferred to M8 but the layout must allow it); and pinning must be per-mount at mount time, not
per-read.

## Decisions needed

- Snapshot/version storage layout — implementation-left by the runtime interface, but it constrains
  M8's expire-together rule; record the choice in the milestone doc or the M1 stack ADR's area.
- The initial policy-class vocabulary (`allow-all` plus which decidable classes) — review-level;
  final vocabulary is spec-amendment material after M9's evidence.

## Verification

1. `pnpm check` — green.
2. Fixture: one mediated volume, one reader environment pinned at activation start, one bridge with
   two request types (`allow-all` agent-authored write; schema-checked structured write).
3. Perform a write crossing; from the reader, confirm the mounted contents are unchanged and match
   the pinned snapshot digest (AC-M5.1).
4. Attempt a direct write from the reader (and from a writer-role environment on an ordinary
   volume aimed at the mediated path); confirm failure (AC-M5.2).
5. Dump the journal: write crossing carries digest, principal, flow, verdict, volume, version;
   reader events carry basis (AC-M5.2, AC-M5.4).
6. Confirm `topology.declared` reports the `allow-all` path (AC-M5.3).
7. Send a schema-violating payload to the checked request type; confirm deny with reason and
   decider (AC-M5.5).
