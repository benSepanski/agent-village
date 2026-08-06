import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  containerPathFor,
  planMounts,
  UndeclaredMountError,
  type MountRequest,
} from './runtime.js';
import type { EnvironmentDecl } from './topology.js';

const environment: EnvironmentDecl = {
  name: 'reader',
  agent_instance: true,
  credential_holding: false,
  request_types: [],
  mounts: [
    { volume: 'shared', role: 'reader', mode: 'read-only', subtree: 'public' },
    { volume: 'prompts', role: 'reader', mode: 'read-only', subtree: '/' },
  ],
};

const request = (over: Partial<MountRequest>): MountRequest => ({
  volume: 'shared',
  role: 'reader',
  mode: 'read-only',
  subtree: 'public',
  host_path: '/store/shared/public',
  ...over,
});

void test('plans a request that matches its declaration, read-only at the mount', () => {
  const planned = planMounts(environment, [request({})]);
  assert.deepEqual(planned, [
    { hostPath: '/store/shared/public', containerPath: containerPathFor('shared'), readOnly: true },
  ]);
});

void test('refuses a request for a volume the environment does not declare', () => {
  assert.throws(
    () => planMounts(environment, [request({ volume: 'scratch', subtree: '/' })]),
    UndeclaredMountError,
  );
});

void test('refuses a request that widens a declared mount', () => {
  assert.throws(
    () => planMounts(environment, [request({ mode: 'read-write' })]),
    UndeclaredMountError,
    'declared read-only, requested read-write',
  );
  assert.throws(
    () => planMounts(environment, [request({ subtree: '/' })]),
    UndeclaredMountError,
    'declared subtree public, requested the volume root',
  );
  assert.throws(
    () => planMounts(environment, [request({ role: 'writer', mode: 'read-write' })]),
    UndeclaredMountError,
    'declared reader, requested writer',
  );
});

void test('refuses mounting one volume twice into one environment', () => {
  assert.throws(() => planMounts(environment, [request({}), request({})]), UndeclaredMountError);
});
