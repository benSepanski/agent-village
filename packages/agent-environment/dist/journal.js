import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
/**
 * Platform-written append-only event stream. Lives outside every environment;
 * nothing here is ever mounted into a container (AC-M1.5). Writes are synchronous
 * so an event is on disk before the action it records proceeds.
 */
export class Journal {
    path;
    identity;
    seq = 0;
    constructor(path, identity) {
        this.path = path;
        this.identity = identity;
    }
    emit(fields) {
        this.seq += 1;
        const record = {
            seq: this.seq,
            ts: new Date().toISOString(),
            application_instance: this.identity.application_instance,
            activation: this.identity.activation,
            flow: this.identity.flow,
            ...fields,
        };
        appendFileSync(this.path, `${JSON.stringify(record)}\n`, 'utf8');
    }
    get file() {
        return this.path;
    }
}
/** Digest of a JSON-serialisable value, used wherever the journal records content by reference. */
export function digestOf(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
//# sourceMappingURL=journal.js.map