/**
 * The M1 slice of the spec's closed event set (spec 0002, "Audit surface").
 * Emitting a name outside this set is a type error; AC-M1.6 checks the journal too.
 */
export const EVENT_NAMES = [
    'topology.declared',
    'instance.started',
    'activation.started',
    'activation.ended',
    'crossing.requested',
    'crossing.decided',
    'crossing.performed',
];
/** Closed reason enum for M1 egress decisions. Disjoint from ingress reasons (none exist in M1). */
export const DENY_REASONS = [
    'request-type-undeclared',
    'payload-schema-violation',
    'payload-size-exceeded',
];
//# sourceMappingURL=events.js.map