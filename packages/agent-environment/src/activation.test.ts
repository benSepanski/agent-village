import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { Activation } from './activation.js';
import { Journal } from './journal.js';

const freshJournal = () => {
  const path = join(mkdtempSync(join(tmpdir(), 'activation-test-')), 'journal.jsonl');
  return new Journal(path, { application_instance: 'ai-t', activation: 'act-t', flow: 'flow-1' });
};

const eventsOf = (journal: Journal) =>
  readFileSync(journal.file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

void test('an activation journals its start with the compute unit and one terminal event', () => {
  const journal = freshJournal();
  const activation = new Activation(journal);
  activation.start('daemon-1');
  activation.end('completed');
  const events = eventsOf(journal);
  assert.deepEqual(
    events.map((e) => e.event),
    ['activation.started', 'activation.ended'],
  );
  assert.equal(events[0]?.compute_unit, 'daemon-1');
  assert.equal(events[1]?.outcome, 'completed');
});

void test('a second terminal event throws instead of journaling (AC-M3.3)', () => {
  const journal = freshJournal();
  const activation = new Activation(journal);
  activation.start('daemon-1');
  activation.end('failed');
  assert.throws(() => activation.end('completed'), /exactly one terminal event/);
  assert.equal(eventsOf(journal).filter((e) => e.event === 'activation.ended').length, 1);
});

void test('an activation cannot end before it starts or start twice', () => {
  const activation = new Activation(freshJournal());
  assert.throws(() => activation.end('completed'), /created/);
  activation.start('daemon-1');
  assert.throws(() => activation.start('daemon-1'), /already started/);
});

void test('beginFlow stamps later events with the new flow', () => {
  const journal = freshJournal();
  const activation = new Activation(journal);
  activation.start('daemon-1');
  journal.beginFlow('flow-2');
  activation.end('completed');
  const events = eventsOf(journal);
  assert.equal(events[0]?.flow, 'flow-1');
  assert.equal(events[1]?.flow, 'flow-2');
});
