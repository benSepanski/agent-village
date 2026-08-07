# QA: M3 Volumes, mounts, and activation lifecycle

Milestone: `../milestones/M3-volumes-and-activations.md`
Date: 2026-08-06
Verdict: Pass with follow-ups

## What was exercised

- `pnpm check` from the repo root — green, exit 0 (36 unit tests pass, format/links/typecheck/lint
  clean).
- `pnpm fixture:m3` in `packages/agent-environment`, live against a Docker daemon (dockerd started
  by the SessionStart hook; compute unit `7ab9ff08-…`) — the milestone's verification steps 2–6
  exactly as written: declare the M3 topology, run one activation across a flow boundary (writer,
  reader, a refused undeclared-mount start, session reset, writer again in flow-2), and check every
  AC against the journal and the probes' reports. All six checks PASS, exit 0.
- **Attack A — mount request differing only in one field.** Fed `planMounts` a reader request that
  matched the declared mount on every field except one, for each field in turn: `subtree` other
  than declared, `subtree "/"` (broader), `mode read-write` (privilege bump), `role writer`. Each
  refused with `UndeclaredMountError`; only the exact declared tuple admitted.
- **Attack B — symlink escape from a reader's subtree.** A writer (subtree `/`) planted three
  symlinks inside `public/`: `esc_rel → ../secret/hidden.txt`, `esc_abs →
/volumes/shared/secret/hidden.txt`, `esc_host → /etc/hostname`. A reader mounted at subtree
  `public` read-only then tried to read through each and to write. Run live over Docker.
- **Attack C — file where a subtree directory belongs.** Two forms: (1) a raw Docker bind of a
  _file_ at the `/volumes/shared` mount point; (2) the realistic path — a writer plants a file
  named `public` at the volume root, then a reader declares subtree `public`, driven through
  `mountRequestsFor` / `VolumeStore.hostPath`.
- **Session-reset depth.** `resetSession` over a `scratch` volume holding nested directories
  (`nested/deep/a.txt`) plus a top-level file, checking the returned digest, the emptied root, and
  the empty-vs-populated digest difference.
- **Audit reconstruction.** Read the fixture journal (`/tmp/agent-environment-m3-*/journal.jsonl`)
  and confirmed every event's identity stamping and the `volume.reset` / `activation.*` records.

## Criteria

| ID      | Result | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-M3.1 | Met    | Reader's `volumes_visible` is `[prompts, shared]` — `scratch` absent from its filesystem. The undeclared-mount start (reader plus a `scratch` mount it does not declare) refused with `UndeclaredMountError` and `environmentExists` was false, so no container was created. Attack A: every single-field deviation (subtree, mode, role) was refused; only the exact declared tuple admitted.                                                          |
| AC-M3.2 | Met    | `scratch` listed `[]` at flow-2 start. `volume.reset` carried `version sha256:e475…` — the pre-reset digest, verified non-empty (differs from the empty-`scratch` digest) — stamped `flow: flow-1` (the ending flow), and the flow-2 `volume.mounted` for `scratch` carried the empty digest. Depth check: `resetSession` also removed nested `nested/deep/a.txt`; returned digest equalled the pre-reset digest; empty digest differed from populated. |
| AC-M3.3 | Met    | Three `instance.started` events plus `activation.started` all carry compute unit `7ab9ff08-…` (set size 1, none missing) — co-location on one logical unit. Exactly one `activation.ended`. Unit tests cover the guards the happy path does not: a second terminal event throws `exactly one terminal event`; ending before start throws; starting twice throws; `failed` is an accepted terminal outcome.                                              |
| AC-M3.4 | Met    | Reader's write to the zero-writer volume `prompts` refused `EROFS: read-only file system` (`/volumes/prompts/injected.txt`); write through the read-only `shared` mount refused `EROFS`. Read-only is the mount flag (`:ro` bind), not file permissions — Attack B's write attempt against the read-only mount also refused `EROFS`.                                                                                                                    |
| AC-M3.5 | Met    | Writer (subtree `/`) sees `[public, public/note.txt, secret, secret/hidden.txt]`; reader (subtree `public`) sees only `[note.txt]` and reads `note.txt` as `flow-1 public note` — content outside the subtree is not present. Attack B: none of the three planted symlinks reached the out-of-subtree secret — `esc_rel` and `esc_abs` both `ENOENT` (their targets do not exist within the reader's mount namespace). See finding 2.                   |

## Audit check

All seven promised events observed. Every record carries `seq`, `ts`, and the full identity
(`application_instance`, `activation`, `flow`); principal `runtime` throughout.

| Promised event       | Observed                                                                                                                           | Principal attributable | Retention bound honoured                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------- |
| `volume.mounted`     | 6 — e.g. `{…,"volume":"shared","version":"sha256:e3b0…","environment":"writer","role":"writer","mode":"read-write","subtree":"/"}` | Yes — `runtime`        | N/A — content store and retention are M8 |
| `volume.digest`      | 3 (one per volume at activation end)                                                                                               | Yes — `runtime`        | N/A — as above                           |
| `volume.reset`       | 1 — `{…,"flow":"flow-1","volume":"scratch","version":"sha256:e475…"}` — the pre-reset digest, stamped with the ending flow         | Yes — `runtime`        | N/A — as above                           |
| `instance.started`   | 3 — each with `environment`, `container`, `compute_unit`                                                                           | Yes — `runtime`        | N/A — as above                           |
| `instance.stopped`   | 3 — each with `exit_code`                                                                                                          | Yes — `runtime`        | N/A — as above                           |
| `activation.started` | 1 — with `compute_unit`                                                                                                            | Yes — `runtime`        | N/A — as above                           |
| `activation.ended`   | 1 — `outcome: completed`                                                                                                           | Yes — `runtime`        | N/A — as above                           |

**Deliberate silences, confirmed present as designed.** The undeclared-mount refusal (AC-M3.1) is
_not_ journaled — the spec's closed event set has no start-refusal event, and the milestone doc
states this. The read-only write denial (AC-M3.4) fails in the kernel (`EROFS`) and is not
journaled; the milestone documents this too. Both silences were verified: no `topology.rejected`,
`instance.started`, or any event follows the refused start; the `EROFS` is observed only from
inside the environment, as the milestone prescribes. A single `volume.reset` record read alone
reconstructs what reset (`scratch`), who (`runtime`), when in the run (`flow-1`, `seq 11`), and the
content digest destroyed.

## Findings

| #   | Severity | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Breaks                                                                                                                                                                      | Disposition                                                                                                                                          |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Low      | File where a reader's subtree directory belongs: a writer plants a file named `public` at the volume root, then a reader declares subtree `public`. `VolumeStore.hostPath` (`mkdirSync` over the subtree) throws a raw `Error: EEXIST` during `mountRequestsFor`, before any container. Fails **closed** (no start), which is correct — but the throw is an untyped `Error`, not `UndeclaredMountError`, so a caller cannot distinguish "malformed subtree collision" from an internal fault, and no journal record marks the refusal | Nothing the spec states — the spec's audit set has no start-refusal event, so the silence is consistent; this is a robustness/diagnosability gap, not a criterion violation | Recorded here and in `docs/ai/`. Not blocking M4. Candidate fix when the runtime gains a start-refusal path: type the throw and surface a diagnostic |
| 2   | Info     | Symlink resolution inside a shared volume: a writer-planted symlink resolves within the **reader's own mount/container namespace**, not the host and not the volume's out-of-subtree content. `../secret` and `/volumes/shared/secret/…` both `ENOENT` (absent from the reader's mount); `/etc/hostname` resolved to the reader's _own container_ file (`65179af3a160`), which the reader could read directly anyway. The subtree guarantee (AC-M3.5) holds against symlink traversal                                                 | Nothing — this is a positive confirmation that subtree enforcement is by the bind mount, not path discipline                                                                | Recorded for the M5 executor (mediated volumes) as evidence the bind-mount-the-subtree approach is symlink-safe. No change                           |

## Not covered

- **Session reset raced against a still-writing container.** `resetSession` is an unguarded
  filesystem destroy; nothing prevents it running while a container writes the volume. M3 scopes
  this out by its own words — "single turn per environment writes without contention" — and defers
  write leases / turn serialisation to M4. Noted, not pressed: there is no concurrent writer in M3
  to race.
- **`durable` contents surviving an application-instance restart** — a spec non-goal (agent-server's
  contract), listed out of scope by the milestone.
- **Mediated volumes and snapshot pinning** — M5. Every durable volume here is ordinary.
- **A volume mounted at two subtrees in one environment** — the `/volumes/<name>` convention mounts
  a volume at most once per environment (enforced in `planMounts`); the milestone's execution note
  flags this for M5 if a driving application needs it. Not exercised as an attack because the
  checker/planner refuse it by construction.
- **Oversized volume trees / digest cost.** `digest` walks the whole tree synchronously; no size
  bound. Volumes are platform-provisioned, not hostile input, so noted rather than pressed.

## Verdict

**Pass with follow-ups.** Every AC-M3 criterion was observed met by rerunning the milestone's
verification exactly as written over a live Docker daemon, and each survived the hostile variants
the fixture does not cover: single-field mount-request deviations are all refused (AC-M3.1),
writer-planted symlinks cannot escape a reader's subtree (AC-M3.5), read-only is enforced at the
kernel (AC-M3.4), and session reset clears nested content with a faithful pre-reset digest
(AC-M3.2). The one real defect — an untyped `EEXIST` throw when a file collides with a reader's
subtree name (finding 1) — fails closed and is Low severity; it is recorded here and in
`docs/ai/` for the M4/M5 executor, and does not block M4. Finding 2 is a positive confirmation
that subtree enforcement is symlink-safe.
