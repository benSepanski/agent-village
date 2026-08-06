import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { EnvironmentDecl, VolumeDecl } from './topology.js';
import { mountRequestsFor, VolumeStore } from './volumes.js';

const volumes: VolumeDecl[] = [
  { name: 'shared', durability: 'durable', mediated: false, credential_class: false },
  { name: 'scratch', durability: 'session', mediated: false, credential_class: false },
];

const freshStore = () => new VolumeStore(mkdtempSync(join(tmpdir(), 'volumes-test-')), volumes);

void test('digest is stable for equal content and moves when content moves', () => {
  const a = freshStore();
  const b = freshStore();
  const empty = a.digest('shared');
  assert.equal(empty, b.digest('shared'), 'two empty volumes digest identically');

  mkdirSync(join(a.volumeRoot('shared'), 'notes'));
  writeFileSync(join(a.volumeRoot('shared'), 'notes', 'a.txt'), 'hello');
  mkdirSync(join(b.volumeRoot('shared'), 'notes'));
  writeFileSync(join(b.volumeRoot('shared'), 'notes', 'a.txt'), 'hello');
  const withContent = a.digest('shared');
  assert.equal(withContent, b.digest('shared'), 'equal trees digest identically');
  assert.notEqual(withContent, empty);

  writeFileSync(join(b.volumeRoot('shared'), 'notes', 'a.txt'), 'changed');
  assert.notEqual(b.digest('shared'), withContent, 'changed content changes the digest');
});

void test('hostPath creates the subtree and refuses an undeclared volume', () => {
  const store = freshStore();
  const path = store.hostPath('shared', 'a/b');
  assert.deepEqual(readdirSync(join(store.volumeRoot('shared'), 'a')), ['b']);
  assert.ok(path.endsWith(join('shared', 'a', 'b')));
  assert.equal(store.hostPath('shared', '/'), store.volumeRoot('shared'));
  assert.throws(() => store.hostPath('journal', '/'), /not declared/);
});

void test('resetSession empties a session volume and returns the pre-reset digest', () => {
  const store = freshStore();
  writeFileSync(join(store.volumeRoot('scratch'), 'state.txt'), 'flow-1 state');
  const before = store.digest('scratch');
  const preReset = store.resetSession('scratch');
  assert.equal(preReset, before, 'volume.reset carries the digest of what was destroyed');
  assert.deepEqual(readdirSync(store.volumeRoot('scratch')), []);
  assert.notEqual(store.digest('scratch'), before);
});

void test('resetSession refuses a volume that is not session-durability', () => {
  const store = freshStore();
  assert.throws(() => store.resetSession('shared'), /not a session volume/);
});

void test('mountRequestsFor derives exactly the declared mount set', () => {
  const store = freshStore();
  const environment: EnvironmentDecl = {
    name: 'writer',
    agent_instance: true,
    credential_holding: false,
    request_types: [],
    mounts: [
      { volume: 'shared', role: 'writer', mode: 'read-write', subtree: '/' },
      { volume: 'scratch', role: 'writer', mode: 'read-write', subtree: 'state' },
    ],
  };
  const requests = mountRequestsFor(environment, store);
  assert.deepEqual(
    requests.map((r) => ({ volume: r.volume, role: r.role, mode: r.mode, subtree: r.subtree })),
    environment.mounts,
  );
  assert.equal(requests[1]?.host_path, store.hostPath('scratch', 'state'));
});
