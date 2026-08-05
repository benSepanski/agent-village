# M2: Topology checker — refuse what the spec refuses

Spec: `../spec.md`
Status: Complete
Depends on: M1

## Slice

The checker enforces every declaration-time rule the spec names: two writers on a volume, a
read-write mount of a mediated volume, the journal mounted into an agent-bearing environment, a
credential-class volume outside a credential-holding environment, a credential-holding environment
mounting another environment's written volume, a mount without a subtree — each refused before
anything runs, with a reason naming the offending element, and `topology.rejected` journaled. It
also surfaces without refusing: a mediated-write bridge with policy class `allow-all` is accepted
and reported as an unmediated write path. Fixture topologies exist for every rule, so the checker's
behaviour is observable, not asserted.

## Out of scope

- Runtime enforcement of what the checker admitted — mounts (M3), pinned snapshots (M5). This
  milestone decides about declarations only.
- The `topology.declared` journal half of AC-1.6 — M5, where mediated volumes first run.
- Checking flow invariants for consistency with declared bridges — M7.

## Acceptance criteria

| ID      | Criterion                                                                                                                                                                                    | Serves | Verified by                             |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------- |
| AC-M2.1 | A topology declaring two writer environments for one volume is rejected with a reason naming the volume                                                                                      | AC-1.1 | Checker run over a fixture topology     |
| AC-M2.2 | A topology read-write mounting a mediated volume is rejected                                                                                                                                 | AC-1.2 | Checker run over a fixture topology     |
| AC-M2.3 | A topology mounting the journal into an agent-bearing environment is rejected                                                                                                                | AC-1.3 | Checker run over a fixture topology     |
| AC-M2.4 | A credential-class volume mounted into an environment not declared credential-holding is rejected; a credential-holding environment mounting a volume another environment writes is rejected | AC-1.4 | Checker run over two fixture topologies |
| AC-M2.5 | A mount without a declared subtree is rejected                                                                                                                                               | AC-1.5 | Checker run over a fixture topology     |
| AC-M2.6 | A mediated-write bridge with policy class `allow-all` is accepted, and the checker's output reports it as an unmediated write path                                                           | AC-1.6 | Checker output over a fixture topology  |
| AC-M2.7 | A rejected declaration emits `topology.rejected` with a reason, and the instance does not start                                                                                              | AC-2.2 | Journal inspection plus a refused start |

## Audit surface

Events: `topology.declared` (now carrying the checker's surfaced findings), `topology.rejected`
with a closed reason enum naming the violated rule and the offending element. Principal: `owner`
(who declared) and `runtime`. Identifiers: `application_instance`. Destination and retention as
M1. Never recorded: the contents of any volume — the checker reads declarations, not data;
credential-class labelling is a declaration-review property per the spec's guarantees.

## Approach

Extend M1's loader into a rule pipeline: each rule is a named predicate over the parsed topology,
producing either nothing, a surfaced finding, or a rejection. One fixture directory per rule,
containing a minimal offending topology — fixtures double as the vocabulary of what the checker
means. What could go wrong: rules that pass on the fixture but miss the same violation expressed
differently (e.g. two writers via two subtrees of one volume); write each fixture in at least the
obvious variant pairs.

## Decisions needed

- The topology file schema stabilises here — every later milestone adds declarations to it. No ADR
  needed unless the format itself changes (it was picked in M1's ADR); schema additions are
  ordinary work inside the spec.

## Verification

1. `pnpm check` — green.
2. Run the checker over each rejection fixture; capture output showing the rule name, the offending
   element, and refusal to start (AC-M2.1 – AC-M2.5, AC-M2.7).
3. Run it over the `allow-all` fixture; capture the acceptance plus the unmediated-write-path
   report (AC-M2.6).
4. Run it over M1's valid fixture; confirm it still starts — the checker must not reject what the
   spec permits.
5. Dump the journal for one rejected run; confirm `topology.rejected` and its reason (AC-M2.7).
