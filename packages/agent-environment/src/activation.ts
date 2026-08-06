import type { Journal } from './journal.js';

/**
 * One run of an application instance, from start to a terminal event — and
 * exactly one terminal event (AC-M3.3): a second end is a platform bug and
 * throws instead of journaling. The compute unit every environment of the
 * activation runs on is journaled at start, so a runtime that could schedule
 * across hosts inherits the co-location requirement explicitly.
 */
export class Activation {
  private state: 'created' | 'started' | 'ended' = 'created';

  constructor(private readonly journal: Journal) {}

  start(computeUnit: string): void {
    if (this.state !== 'created') {
      throw new Error(`activation already ${this.state}`);
    }
    this.state = 'started';
    this.journal.emit({
      event: 'activation.started',
      principal: { kind: 'runtime' },
      turn: null,
      compute_unit: computeUnit,
    });
  }

  end(outcome: 'completed' | 'failed'): void {
    if (this.state !== 'started') {
      throw new Error(`activation is ${this.state}; an activation has exactly one terminal event`);
    }
    this.state = 'ended';
    this.journal.emit({
      event: 'activation.ended',
      principal: { kind: 'runtime' },
      turn: null,
      outcome,
    });
  }
}
