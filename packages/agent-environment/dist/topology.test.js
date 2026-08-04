import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkTopology, TopologyError } from './topology.js';
const fixture = () => ({
    version: 'm1',
    application: 'm1-walking-skeleton',
    environment: { name: 'probe', agent_instance: true, request_types: ['probe.echo'] },
    bridge: {
        name: 'probe-egress',
        direction: 'egress',
        from: 'probe',
        target: 'network',
        request_types: [
            {
                name: 'probe.echo',
                fidelity: 'parsed',
                content: 'structured',
                retryable: true,
                policy: { kind: 'program', max_message_bytes: 256 },
            },
        ],
    },
});
void test('accepts the M1 fixture topology', () => {
    const topology = checkTopology(fixture());
    assert.equal(topology.application, 'm1-walking-skeleton');
    assert.equal(topology.bridge.request_types[0]?.policy.max_message_bytes, 256);
});
void test('refuses a declaration with keys it cannot represent', () => {
    const raw = { ...fixture(), volumes: [] };
    assert.throws(() => checkTopology(raw), TopologyError);
    assert.throws(() => checkTopology(raw), /volumes/);
});
void test('refuses an ingress bridge', () => {
    const raw = fixture();
    raw.bridge.direction = 'ingress';
    assert.throws(() => checkTopology(raw), /egress/);
});
void test('refuses an environment invoking a request type no bridge declares', () => {
    const raw = fixture();
    raw.environment.request_types = ['probe.echo', 'probe.ghost'];
    assert.throws(() => checkTopology(raw), /probe.ghost/);
});
void test('refuses a bridge from an undeclared environment', () => {
    const raw = fixture();
    raw.bridge.from = 'elsewhere';
    assert.throws(() => checkTopology(raw), /elsewhere/);
});
void test('refuses a non-program policy', () => {
    const raw = fixture();
    raw.bridge.request_types[0].policy.kind = 'auth-environment';
    assert.throws(() => checkTopology(raw), /program/);
});
//# sourceMappingURL=topology.test.js.map