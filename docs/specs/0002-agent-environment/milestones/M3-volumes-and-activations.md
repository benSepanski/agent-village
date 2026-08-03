# M3: Volumes, mounts, and activation lifecycle

Spec: `../spec.md`
Status: Planned
Depends on: M2

## Slice

Volumes exist as declared things with durability classes, and the runtime mounts exactly what the
topology says: declared volumes only, at declared subtrees, in declared modes, with a zero-writer
volume read-only at the mount. A volume not in an environment's mount set is absent from its
filesystem, and an undeclared mount request fails the instance start. A `session` volume's contents
are destroyed at its declared flow boundary, with `volume.reset` carrying the pre-reset digest. An
activation starts, co-locates all its environments on one logical compute unit, and ends with
exactly one terminal event. Two environments co-mounting one volume (one writer, one reader) can
pass data, and the topology shows it — the spec's visibility-over-prohibition stance, now
observable.

## Out of scope

- Write leases and turn serialisation — M4. Within this milestone a single turn per environment
  writes without contention.
- Mediated volumes and snapshot pinning — M5. Here every durable volume is ordinary.
- `durable` contents surviving an application-instance restart — agent-server's contract, a spec
  non-goal.

## Acceptance criteria

| ID      | Criterion                                                                                                                             | Serves | Verified by                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------- |
| AC-M3.1 | A volume not in an environment's mount set is absent from its filesystem, and an undeclared mount request fails to start the instance | AC-2.2 | Filesystem inspection plus a rejected start |
| AC-M3.2 | A `session` volume is empty at the start of the next flow, and `volume.reset` carries the pre-reset digest                            | AC-2.4 | Journal plus filesystem inspection          |
| AC-M3.3 | All environments of an activation are co-located on one logical compute unit, and the activation has exactly one terminal event       | AC-5.1 | Runtime inspection plus journal             |
| AC-M3.4 | A zero-writer volume is mounted read-only, and a write to it from inside the environment fails                                        | AC-2.2 | Write attempt from inside the environment   |
| AC-M3.5 | A reader's mount honours its declared subtree: content of the volume outside the subtree is not visible                               | AC-2.2 | Filesystem inspection                       |

## Audit surface

Events: `volume.mounted`, `volume.digest`, `volume.reset`, `instance.started`, `instance.stopped`,
`activation.started`, `activation.ended`. Principals: `runtime`. Identifiers: volume and version on
volume events, `application_instance`, `activation`. Per the spec's deliberate absence: a write
blocked by a read-only mount fails in the kernel and is not journaled — that denial lives at
`topology.rejected` / mount declaration time, and AC-M3.4 verifies the failure by observation from
inside, not by expecting an event. Never recorded: per-file reads and writes, ephemeral volume
contents.

## Approach

Volume storage is implementation-left by the runtime interface: host directories bind-mounted per
declaration is the obvious Docker shape. Session reset is destroy-and-recreate at the declared
boundary, digesting first. Co-location is trivially true on one Docker host but must still be
asserted and journaled so a second runtime implementation inherits the requirement. What could go
wrong: subtree enforcement must be by mounting the subtree itself, not by trusting path discipline;
read-only must be the mount flag, not file permissions.

## Decisions needed

- Where the flow boundary that resets a `session` volume is declared in the topology schema —
  settle in review; no ADR unless it changes the terminology's meaning of `session`.

## Verification

1. `pnpm check` — green.
2. Start a fixture with two environments sharing a volume (one writer, one reader on a subtree),
   plus a zero-writer volume and a session volume.
3. From inside each environment: list mounts, confirm absent volumes are absent (AC-M3.1), the
   subtree bound holds (AC-M3.5), and a write to the zero-writer volume fails (AC-M3.4).
4. Start a fixture whose runtime request includes an undeclared mount; capture the refused start
   (AC-M3.1).
5. Drive a flow boundary; confirm the session volume is empty next flow and `volume.reset` carries
   the prior digest (AC-M3.2).
6. End the activation; confirm co-location in runtime state and exactly one terminal event in the
   journal (AC-M3.3).
