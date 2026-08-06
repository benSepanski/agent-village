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
  private readonly identity: JournalIdentity;

  constructor(
    private readonly path: string,
    identity: JournalIdentity,
  ) {
    this.identity = { ...identity };
  }

  /**
   * Advances the journal to a new flow at a flow boundary. M6 owns real flow
   * minting at ingress admission; until then the platform runner drives the
   * boundary and names the flows.
   */
  beginFlow(flow: string): void {
    this.identity.flow = flow;
  }

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
