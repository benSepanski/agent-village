import { createServer } from 'node:net';
import { digestOf } from './journal.js';
/**
 * The egress bridge, plus the platform side of the harness in M1: the declared
 * request-type check (AC-M1.4) runs here, on the platform side of the channel,
 * because a record written from inside the environment could not be trusted to
 * exist (AC-M1.5). Identity on events is stamped from the topology and the
 * runtime's own identifiers, never from anything the environment claims.
 */
export class Bridge {
    topology;
    journal;
    turn;
    identity;
    crossings = 0;
    server = null;
    constructor(topology, journal, turn, identity) {
        this.topology = topology;
        this.journal = journal;
        this.turn = turn;
        this.identity = identity;
    }
    async listen(socketPath) {
        const server = createServer((socket) => this.serve(socket));
        this.server = server;
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(socketPath, resolve);
        });
    }
    async close() {
        const server = this.server;
        if (server) {
            await new Promise((resolve) => server.close(() => resolve()));
        }
    }
    serve(socket) {
        let buffer = '';
        socket.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            let newline = buffer.indexOf('\n');
            while (newline >= 0) {
                const line = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                if (line.trim().length > 0) {
                    socket.write(`${JSON.stringify(this.handleLine(line))}\n`);
                }
                newline = buffer.indexOf('\n');
            }
        });
        socket.on('error', () => socket.destroy());
    }
    handleLine(line) {
        let request;
        try {
            request = JSON.parse(line);
        }
        catch {
            request = { op: 'invoke', request_type: 'unparseable', payload: null };
        }
        return this.invoke(request);
    }
    invoke(request) {
        this.crossings += 1;
        const crossing = `x-${this.crossings}`;
        const requestDigest = digestOf(request.payload);
        const bridgeName = this.topology.bridge.name;
        const common = {
            crossing,
            bridge: bridgeName,
            request_type: request.request_type,
            request_digest: requestDigest,
        };
        const requester = {
            kind: 'agent-instance',
            application_instance: this.identity.application_instance,
            environment: this.topology.environment.name,
            activation: this.identity.activation,
            turn: this.turn,
        };
        const bridgePrincipal = { kind: 'bridge', bridge: bridgeName };
        this.journal.emit({
            event: 'crossing.requested',
            principal: requester,
            turn: this.turn,
            ...common,
        });
        const verdict = this.decide(request);
        this.journal.emit({
            event: 'crossing.decided',
            principal: bridgePrincipal,
            turn: this.turn,
            ...common,
            verdict: verdict.allow ? 'allow' : 'deny',
            decider: 'program',
            reason: verdict.allow ? null : verdict.reason,
        });
        if (!verdict.allow) {
            return { ok: false, crossing, verdict: 'deny', reason: verdict.reason };
        }
        const result = { echoed: request.payload.message };
        this.journal.emit({
            event: 'crossing.performed',
            principal: bridgePrincipal,
            turn: this.turn,
            ...common,
            result_digest: digestOf(result),
        });
        return { ok: true, crossing, result };
    }
    decide(request) {
        if (!this.topology.environment.request_types.includes(request.request_type)) {
            return { allow: false, reason: 'request-type-undeclared' };
        }
        const decl = this.topology.bridge.request_types.find((rt) => rt.name === request.request_type);
        if (!decl) {
            return { allow: false, reason: 'request-type-undeclared' };
        }
        const payload = request.payload;
        if (typeof payload !== 'object' ||
            payload === null ||
            Array.isArray(payload) ||
            typeof payload.message !== 'string' ||
            Object.keys(payload).length !== 1) {
            return { allow: false, reason: 'payload-schema-violation' };
        }
        const bytes = Buffer.byteLength(payload.message, 'utf8');
        if (bytes > decl.policy.max_message_bytes) {
            return { allow: false, reason: 'payload-size-exceeded' };
        }
        return { allow: true };
    }
}
//# sourceMappingURL=bridge.js.map