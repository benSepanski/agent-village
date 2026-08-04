import type { JournalEvent } from './events.js';
/** What the emitter supplies: the event minus everything the platform stamps. Distributes over the union so each event keeps its own fields. */
export type PlatformStamped<E> = E extends JournalEvent ? Omit<E, 'seq' | 'ts' | 'application_instance' | 'activation' | 'flow'> : never;
/** The identifiers every M1 event is stamped with. The flow is the placeholder minted at activation start (M6 owns real flows). */
export interface JournalIdentity {
    application_instance: string;
    activation: string;
    flow: string;
}
/**
 * Platform-written append-only event stream. Lives outside every environment;
 * nothing here is ever mounted into a container (AC-M1.5). Writes are synchronous
 * so an event is on disk before the action it records proceeds.
 */
export declare class Journal {
    private readonly path;
    private readonly identity;
    private seq;
    constructor(path: string, identity: JournalIdentity);
    emit(fields: PlatformStamped<JournalEvent>): void;
    get file(): string;
}
/** Digest of a JSON-serialisable value, used wherever the journal records content by reference. */
export declare function digestOf(value: unknown): string;
