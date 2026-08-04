import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';

import type { JournalEvent } from './events.js';

/** What the emitter supplies: the event minus everything the platform stamps. Distributes over the union so each event keeps its own fields. */
export type PlatformStamped<E> = E extends JournalEvent
  ? Omit<E, 'seq' | 'ts' | 'application_instance' | 'activation' | 'flow'>
  : never;

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
export class Journal {
  private seq = 0;

  constructor(
    private readonly path: string,
    private readonly identity: JournalIdentity,
  ) {}

  emit(fields: PlatformStamped<JournalEvent>): void {
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

  get file(): string {
    return this.path;
  }
}

/** Digest of a JSON-serialisable value, used wherever the journal records content by reference. */
export function digestOf(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
