import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { Bridge } from './bridge.js';
import { EVENT_NAMES } from './events.js';
import { Journal } from './journal.js';
import { checkTopology } from './topology.js';

const checked = checkTopology({
  version: 1,
  application: 'm1-walking-skeleton',
  volumes: [],
  environments: [
    {
      name: 'probe',
      agent_instance: true,
      credential_holding: false,
      request_types: ['probe.echo'],
      mounts: [],
    },
  ],
  bridges: [
    {
      name: 'probe-egress',
      direction: 'egress',
      from: 'probe',
      target: { kind: 'network' },
      request_types: [
        {
          name: 'probe.echo',
          fidelity: 'parsed',
          content: 'structured',
          retryable: true,
          policy: { kind: 'program', max_message_bytes: 16 },
        },
      ],
    },
  ],
});
if (!checked.accepted) throw new Error('test topology must be accepted');
const topology = checked.topology;

function makeBridge() {
  const dir = mkdtempSync(join(tmpdir(), 'ae-test-'));
  const path = join(dir, 'journal.jsonl');
  const journal = new Journal(path, {
    application_instance: 'ai-test',
    activation: 'act-test',
    flow: 'flow-test',
  });
  const bridge = new Bridge(topology.environments[0]!, topology.bridges[0]!, journal, 'turn-1', {
    application_instance: 'ai-test',
    activation: 'act-test',
  });
  const events = () =>
    readFileSync(path, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  return { bridge, events };
}

void test('allowed crossing emits requested, decided(allow, program), performed with one id', () => {
  const { bridge, events } = makeBridge();
  const response = bridge.invoke({
    op: 'invoke',
    request_type: 'probe.echo',
    payload: { message: 'hi' },
  });
  assert.equal(response.ok, true);
  const seq = events();
  assert.deepEqual(
    seq.map((e) => e.event),
    ['crossing.requested', 'crossing.decided', 'crossing.performed'],
  );
  assert.equal(new Set(seq.map((e) => e.crossing)).size, 1);
  const decided = seq[1]!;
  assert.equal(decided.verdict, 'allow');
  assert.equal(decided.decider, 'program');
});

void test('oversize payload is denied with a closed-enum reason and no performed event', () => {
  const { bridge, events } = makeBridge();
  const response = bridge.invoke({
    op: 'invoke',
    request_type: 'probe.echo',
    payload: { message: 'far too long for a 16 byte bound' },
  });
  assert.equal(response.ok, false);
  const decided = events().find((e) => e.event === 'crossing.decided')!;
  assert.equal(decided.verdict, 'deny');
  assert.equal(decided.reason, 'payload-size-exceeded');
  assert.ok(!events().some((e) => e.event === 'crossing.performed'));
});

void test('undeclared request type is refused and recorded', () => {
  const { bridge, events } = makeBridge();
  const response = bridge.invoke({
    op: 'invoke',
    request_type: 'probe.forbidden',
    payload: { message: 'x' },
  });
  assert.equal(response.ok, false);
  assert.equal(!response.ok && response.reason, 'request-type-undeclared');
  const decided = events().find((e) => e.event === 'crossing.decided')!;
  assert.equal(decided.reason, 'request-type-undeclared');
});

void test('malformed payload is denied as schema violation', () => {
  const { bridge } = makeBridge();
  const response = bridge.invoke({
    op: 'invoke',
    request_type: 'probe.echo',
    payload: { message: 'hi', extra: true },
  });
  assert.equal(!response.ok && response.reason, 'payload-schema-violation');
});

void test('every emitted event uses a closed-set name and carries the full envelope', () => {
  const { bridge, events } = makeBridge();
  bridge.invoke({ op: 'invoke', request_type: 'probe.echo', payload: { message: 'hi' } });
  bridge.invoke({ op: 'invoke', request_type: 'probe.forbidden', payload: null });
  for (const e of events()) {
    assert.ok((EVENT_NAMES as readonly string[]).includes(e.event as string));
    for (const key of ['application_instance', 'activation', 'flow', 'principal', 'seq', 'ts']) {
      assert.ok(key in e, `missing ${key}`);
    }
  }
});
