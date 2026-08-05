import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkTopology, type RejectionReason } from './topology.js';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

const loadFixture = (path: string): unknown =>
  JSON.parse(readFileSync(join(fixtures, path), 'utf8'));

const valid = () => ({
  version: 1,
  application: 'checker-valid',
  volumes: [
    { name: 'spool', durability: 'durable', mediated: false, credential_class: false },
    { name: 'memory', durability: 'durable', mediated: true, credential_class: false },
  ],
  environments: [
    {
      name: 'triage',
      agent_instance: true,
      credential_holding: false,
      request_types: [],
      mounts: [{ volume: 'spool', role: 'reader', mode: 'read-only', subtree: 'inbox' }],
    },
    {
      name: 'assistant',
      agent_instance: true,
      credential_holding: false,
      request_types: ['memory.append'],
      mounts: [{ volume: 'memory', role: 'reader', mode: 'read-only', subtree: 'facts' }],
    },
  ],
  bridges: [
    {
      name: 'memory-write',
      direction: 'egress',
      from: 'assistant',
      target: { kind: 'volume', volume: 'memory' },
      request_types: [
        {
          name: 'memory.append',
          fidelity: 'parsed',
          content: 'agent-authored',
          retryable: true,
          policy: { kind: 'program', max_message_bytes: 4096 },
        },
      ],
    },
  ],
});

const expectRejection = (
  raw: unknown,
  reason: RejectionReason,
  element: { volume?: string; environment?: string },
) => {
  const result = checkTopology(raw);
  assert.equal(result.accepted, false, `expected rejection with ${reason}`);
  if (result.accepted) return;
  const violation = result.violations.find((v) => v.reason === reason);
  assert.ok(
    violation,
    `expected ${reason}, got ${result.violations.map((v) => v.reason).join(',')}`,
  );
  if (element.volume !== undefined) assert.equal(violation.volume, element.volume);
  if (element.environment !== undefined) assert.equal(violation.environment, element.environment);
  assert.ok(violation.detail.length > 0);
};

void test('accepts a well-formed topology with no findings', () => {
  const result = checkTopology(valid());
  assert.equal(result.accepted, true);
  if (result.accepted) assert.deepEqual(result.findings, []);
});

void test('accepts the M1 fixture topology unchanged', () => {
  const result = checkTopology(loadFixture('m1-topology.json'));
  assert.equal(result.accepted, true);
  if (result.accepted) assert.deepEqual(result.findings, []);
});

void test('AC-M2.1: rejects two writer environments on one volume, naming the volume', () => {
  expectRejection(
    loadFixture('m2/two-writers/two-writer-environments.json'),
    'volume-has-multiple-writers',
    { volume: 'ledger' },
  );
  expectRejection(
    loadFixture('m2/two-writers/two-writers-via-subtrees.json'),
    'volume-has-multiple-writers',
    { volume: 'ledger' },
  );
});

void test('one environment writing two subtrees of one volume is one writer, not two', () => {
  const raw = valid();
  raw.environments[0]!.mounts = [
    { volume: 'spool', role: 'writer', mode: 'read-write', subtree: 'inbox' },
    { volume: 'spool', role: 'writer', mode: 'read-write', subtree: 'outbox' },
  ];
  assert.equal(checkTopology(raw).accepted, true);
});

void test('AC-M2.2: rejects any writable mount of a mediated volume', () => {
  expectRejection(
    loadFixture('m2/mediated-read-write/writer-mount.json'),
    'mediated-volume-mounted-read-write',
    { volume: 'memory', environment: 'assistant' },
  );
  expectRejection(
    loadFixture('m2/mediated-read-write/reader-mount-read-write.json'),
    'mediated-volume-mounted-read-write',
    { volume: 'memory', environment: 'assistant' },
  );
});

void test('AC-M2.3: rejects the journal mounted into an agent-bearing environment', () => {
  expectRejection(
    loadFixture('m2/journal-mount/into-agent-environment.json'),
    'journal-mounted-into-agent-environment',
    { environment: 'assistant' },
  );
  const result = checkTopology(loadFixture('m2/journal-mount/alongside-agentless-reader.json'));
  assert.equal(result.accepted, false);
  if (!result.accepted) {
    assert.deepEqual(
      result.violations.map((v) => v.environment),
      ['assistant'],
    );
  }
});

void test('the journal readable from an agentless environment is permitted', () => {
  const raw = valid();
  raw.environments.push({
    name: 'auditor',
    agent_instance: false,
    credential_holding: false,
    request_types: [],
    mounts: [{ volume: 'journal', role: 'reader', mode: 'read-only', subtree: 'audit' }],
  });
  assert.equal(checkTopology(raw).accepted, true);
});

void test('a writer mount of the journal is malformed: the platform is its only writer', () => {
  const raw = valid();
  raw.environments[0]!.mounts = [
    { volume: 'journal', role: 'writer', mode: 'read-write', subtree: 'audit' },
  ];
  expectRejection(raw, 'declaration-malformed', {});
});

void test('AC-M2.4: rejects a credential-class volume outside a credential-holding environment', () => {
  expectRejection(
    loadFixture('m2/credential-volume/outside-credential-environment.json'),
    'credential-volume-outside-credential-environment',
    { volume: 'vault-keys', environment: 'assistant' },
  );
  expectRejection(
    loadFixture('m2/credential-volume/writer-outside-credential-environment.json'),
    'credential-volume-outside-credential-environment',
    { volume: 'vault-keys', environment: 'provisioner' },
  );
});

void test('AC-M2.4: rejects a credential-holding environment mounting a foreign-written volume', () => {
  expectRejection(
    loadFixture('m2/credential-environment/mounts-foreign-written-volume.json'),
    'credential-environment-mounts-foreign-written-volume',
    { volume: 'notes', environment: 'vault' },
  );
  expectRejection(
    loadFixture('m2/credential-environment/foreign-writer-different-subtree.json'),
    'credential-environment-mounts-foreign-written-volume',
    { volume: 'notes', environment: 'vault' },
  );
});

void test('a credential-holding environment mounting its own written volume is permitted', () => {
  const raw = valid();
  raw.volumes.push({
    name: 'vault-keys',
    durability: 'durable',
    mediated: false,
    credential_class: true,
  });
  raw.environments.push({
    name: 'vault',
    agent_instance: true,
    credential_holding: true,
    request_types: [],
    mounts: [
      { volume: 'vault-keys', role: 'reader', mode: 'read-only', subtree: 'mail' },
      { volume: 'spool', role: 'writer', mode: 'read-write', subtree: 'state' },
    ],
  });
  assert.equal(checkTopology(raw).accepted, true);
});

void test('AC-M2.5: rejects a mount without a declared subtree', () => {
  expectRejection(
    loadFixture('m2/missing-subtree/writer-missing-subtree.json'),
    'mount-missing-subtree',
    {
      volume: 'scratch',
      environment: 'searcher',
    },
  );
  expectRejection(
    loadFixture('m2/missing-subtree/reader-null-subtree.json'),
    'mount-missing-subtree',
    {
      volume: 'scratch',
      environment: 'searcher',
    },
  );
});

void test('AC-M2.6: accepts allow-all mediated write and surfaces it as an unmediated write path', () => {
  const result = checkTopology(loadFixture('m2/allow-all/unmediated-write-path.json'));
  assert.equal(result.accepted, true);
  if (result.accepted) {
    assert.equal(result.findings.length, 1);
    const finding = result.findings[0]!;
    assert.equal(finding.finding, 'unmediated-write-path');
    assert.equal(finding.bridge, 'memory-write');
    assert.equal(finding.volume, 'memory');
    assert.equal(finding.request_type, 'memory.append');
  }
});

void test('a topology violating several rules reports every violation', () => {
  const raw = loadFixture('m2/two-writers/two-writer-environments.json') as ReturnType<
    typeof valid
  >;
  raw.environments[0]!.mounts.push({
    volume: 'ledger',
    role: 'reader',
    mode: 'read-only',
  } as never);
  const result = checkTopology(raw);
  assert.equal(result.accepted, false);
  if (!result.accepted) {
    const reasons = result.violations.map((v) => v.reason);
    assert.ok(reasons.includes('volume-has-multiple-writers'));
    assert.ok(reasons.includes('mount-missing-subtree'));
  }
});

void test('malformed declarations refuse with declaration-malformed', () => {
  expectRejection({ ...valid(), surprise: true }, 'declaration-malformed', {});
  expectRejection({ ...valid(), version: 'm1' }, 'declaration-malformed', {});

  const reservedName = valid();
  reservedName.volumes.push({
    name: 'journal',
    durability: 'durable',
    mediated: false,
    credential_class: false,
  });
  expectRejection(reservedName, 'declaration-malformed', {});

  const danglingMount = valid();
  danglingMount.environments[0]!.mounts[0]!.volume = 'ghost';
  expectRejection(danglingMount, 'declaration-malformed', {});

  const unmediatedTarget = valid();
  (unmediatedTarget.bridges[0]!.target as { volume: string }).volume = 'spool';
  expectRejection(unmediatedTarget, 'declaration-malformed', {});

  const undeclaredInvocation = valid();
  undeclaredInvocation.environments[1]!.request_types = ['memory.append', 'memory.ghost'];
  expectRejection(undeclaredInvocation, 'declaration-malformed', {});

  const mediatedSession = valid();
  mediatedSession.volumes[1]!.durability = 'session';
  expectRejection(mediatedSession, 'declaration-malformed', {});
});
