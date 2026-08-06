# M3 (volumes and activations) executed

2026-08-06, autonomous routine run.

Done this run:

- **No open PRs to triage**; branched from main at #51.
- **M3 built and verified live**: host-directory volume storage (`VolumeStore`) with content
  digests and session reset; the runtime mounts exactly the declared set (`planMounts` refuses any
  request the declaration does not name, before a container exists); read-only is the mount flag;
  subtree enforcement is by mounting the subtree itself, with a parser rule refusing traversing
  subtrees; `Activation` enforces exactly one terminal event and journals the compute unit; new
  events `volume.mounted` / `volume.digest` / `volume.reset` / `instance.stopped`. All of
  AC-M3.1 – AC-M3.5 verified in this container over Docker via `pnpm fixture:m3`; `fixture:m1`
  and `fixture:m2` rerun clean on the migrated runtime API; `pnpm check` green.
- **Decision settled in the milestone doc**: the `session` reset boundary is not a schema field —
  `session` durability itself declares a reset at every flow boundary. No ADR; terminology
  unchanged.
- **Deliberately out of M3, recorded here**: a runtime mount request is refused, not journaled —
  the spec's closed event set has no start-refusal event (the declaration-time denial is
  `topology.rejected`). One container per flow phase stands in for turns until M4 delivers
  wakeups; a volume mounts at most once per environment (the `/volumes/<name>` mount-point
  convention), which M5 can revisit if a driving application needs two subtrees of one volume in
  one environment.

Notification decision: none sent this run — nothing needs owner action now (M3 QA is the next
routine's work, not the owner's).

Next run, per the routing table: **M3 is Complete but not QA'd** — QA it
([qa-a-milestone](../dev/workflows/qa-a-milestone.md)): rerun `pnpm fixture:m3` fresh over Docker
(the SessionStart hook starts dockerd), then attempt hostile variants the fixture does not cover —
e.g. a mount request differing only in subtree, a symlink planted inside a volume pointing outside
it, a session reset raced against a still-writing container, a subtree that is a file rather than
a directory.

Standing items, carried forward from [2026-08-05-qa-m2.md](2026-08-05-qa-m2.md):

- **Branch protection**: owner should verify the ruleset does what they intend. One reminder
  warranted if unaddressed, none before 2026-08-10.
- **ADR-0005 and ADR-0006 remain `Proposed`**; spec 0001's M1 is gated on those rulings.
- Spec 0002's open questions still hold two owner rulings (`model.infer` spend-meter boundary;
  ADR-0003 retention-scope amendment). Neither blocks M4.
- M2 QA findings 2–5 (bridge-path writer counting, credential-environment bridge targets,
  `allow-all` network bridges, two bridges on one mediated volume) await owner rulings; none block
  M4.
