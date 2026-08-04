# ADR 0005: Identity is the grant-directory path

Date: 2026-08-02
Status: Proposed
Driver: [spec 0001](../specs/0001-agent-cli/spec.md)

## Context

[ADR-0003](0003-auditability-is-a-requirement.md) requires every record to name the principal it happened on behalf of. That is its second question, and in [spec 0001](../specs/0001-agent-cli/spec.md) it is the one most tempting to answer with something the caller supplied — the caller is the only party that knows what it is trying to do, and asking it is one field of schema away.

Each obvious design fails, and each fails differently.

- **An identity field in the envelope** is authored inside the sandbox. The envelope is untrusted in full and in every field, and the sandbox is the one party this whole component exists to distrust. A principal chosen by the party it accuses is worse than no principal at all, because it reads like evidence.
- **Peer credentials on the connection** identify the process on the other end but not which capability that process is exercising. Two wraps granted to one sandbox produce identical peer credentials, so a record could not say which of them was about to have a credential bound to it.
- **A registry mapping live connections to identities** is a second source of truth. It can disagree with the filesystem that actually admitted the connection, and nothing says which of the two is right when it does.

Two further constraints are real rather than assumed. Revocation has to be fast and has to leave a record, because an operator revokes under time pressure and afterwards has to explain what was cut. And an operator has to be able to answer "what can this sandbox reach?" without reading configuration, because configuration states intent and that question is about fact.

## Decision

**A sandbox's capability set is a directory of unix sockets**, laid out as `grants/<app>/<instance>/<session>/<command>.sock` and bind-mounted into exactly that sandbox and no other. The **principal** on every request-scope record — `{app, instance, session, wrap}` — is derived from the path of the socket that accepted the connection.

**No identity field ever crosses the boundary.** The envelope schema has none and rejects unknown keys, so there is nothing for a sandbox to assert and nothing for the auth process to believe. Identity is a property of where a connection arrived, never of what it said.

This is more than a naming choice. What follows from it:

- **A sandbox's complete capability set is `ls` on one directory.** Not a query over the deployed set and not a derivation from wrap files: the filesystem topology is the capability set, so the answer to "what can this sandbox reach?" is a listing.
- **Revocation is deleting a file.** Reachability is the grant, so removing the socket makes `connect(2)` fail. It takes effect at the next invocation with no configuration change inside the sandbox, and that invocation exits 127 (G3, AC-2.2).
- **A command-name collision inside one grant directory is refused as a filesystem fact**, not adjudicated as a policy question. Two wraps granted to one session cannot share a command name because two files cannot share a name.
- **Correlation identifiers for a whole session come from the path.** `app`, `instance` and `session` are read from the directory that admitted the connection rather than minted by a process that cannot observe when a sandbox starts or stops. A fabricated session id is not a thing this design is able to produce.
- **Splitting into one auth process per credential is a deployment change, not a change to the wire contract.** Each process serves the sockets it owns and derives the same principal from the same paths, with no envelope field to renegotiate. That is what makes deferring the auth process's own confinement affordable rather than reckless (Q9).

The derived principal is enforced in types rather than by convention: on the stack [ADR-0004](0004-typescript-node-for-agent-cli.md) chooses, an event carrying neither principal nor actor fails schema validation and is a compile error to construct.

## Alternatives considered

| Alternative                                  | Why not                                                                                                                                                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An identity field in the envelope            | Authored inside the sandbox, which is the party the component exists to distrust. Every envelope field is untrusted, and a forgeable principal is indistinguishable from a true one at read time.                                   |
| Peer credentials on the connection, alone    | They identify the process, not the capability it is exercising. Two wraps granted to one sandbox are indistinguishable, so `credential.bound` could not name which credential the invocation was about to use.                      |
| A registry mapping connections to identities | A second source of truth that can disagree with the filesystem that admitted the connection, with no rule for resolving the disagreement, and one more thing to keep consistent with every revocation.                              |
| A signed token issued to the sandbox         | The sandbox then holds a credential, which is exactly what this component exists to prevent. It also turns revocation from deleting a file into expiring or invalidating a token, which is slower, stateful, and harder to explain. |

## Consequences

This is a contract on a component that does not exist yet. `agent-environment` creates the grant directory and bind-mounts it; agent-cli assumes it and creates neither. `agent-server`, which names applications and their instances, inherits the `app` and `instance` components of the path as the names appearing in every audit record for the lifetime of the system.

That inheritance is why this is an ADR and not a paragraph in the spec: reversing it later changes the wire contract, the audit schema and the sandbox runtime at once, and none of those three can move without the other two.

- **Easier:** capability review, revocation and session correlation are one filesystem question each; the auth process holds no identity state to keep in sync; the principal on a record is derived rather than trusted.
- **Harder:** agent-cli cannot ship into an environment unwilling to give it this layout, and the layout has to be agreed with a component whose spec is unwritten.
- **Accepted cost:** the principal is exactly as trustworthy as the mount. Everything above rests on the assumption stated in G2 — the runtime bind-mounts only that session's directory, and the sandbox uid cannot create files in it. If either half fails, a sandbox can reach a capability it was not granted and the records will attribute it to whoever the path names.
- **The owner decision is spec 0001's Q3**: whether agent-environment accepts this layout as binding. The fallback if it does not — agent-cli reading an operator-written identity file — is strictly weaker, and is recorded as such here rather than presented as an equal option: it reintroduces the second source of truth this decision removes, it makes `session` an operator's assertion instead of a filesystem fact, and it demotes AC-4.2 from a property of the design to a property of an operator's discipline.
- **Revisit if:** agent-environment's spec lands with a runtime that cannot bind-mount a per-session directory, or one that must place two sessions in a single directory. Either is observable as the layout being uncreatable rather than as a vague inconvenience, and either promotes the identity file from fallback to mechanism.

## Audit surface

This decision **is** an audit mechanism, so its surface is what it supplies to every other record rather than records of its own.

- **The principal on every `R`-envelope event.** `principal = {app, instance, session, wrap}`, every field derived from the accepting socket's path, on every request-scope event in spec 0001's closed event set. This is ADR-0003's second question answered by construction: there is no code path that emits a request-scope record without one.
- **Correlation across a whole session.** `app`, `instance` and `session` come from the path and are stable for the sandbox's lifetime, which is what lets one session be reconstructed end to end from the journal alone, across a sandbox restart (AC-4.2).
- **Readership.** One instance's records are never readable by another: `journal` and `observe` filter by instance and refuse request ids and sessions outside the caller's instance, and the instance they filter on is the one in the path (AC-4.4).
- **Changes to the grant directory are themselves recorded**: `wrap.deployed` when a socket appears, `wrap.revoked` when one is removed from a session's grant directory, naming the app, instance and session it was removed from.
- **Retention is unchanged by this decision** and stays the spec's: 30 days or 2 GiB per auth process, whichever binds first, whole day-files dropped oldest-first.

The honest limit: every line above is only as good as the runtime's mount discipline. Deriving the principal from a path removes forgery over the wire; it does not remove it from a runtime that mounts the wrong directory, and this ADR claims nothing about one that does.

See [0003-auditability-is-a-requirement.md](0003-auditability-is-a-requirement.md).
