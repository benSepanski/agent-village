import { createServer, type Server, type Socket } from 'node:net';

import type { DenyReason, Principal } from './events.js';
import { digestOf, type Journal } from './journal.js';
import type { BridgeDecl, EnvironmentDecl } from './topology.js';

/**
 * Wire protocol on the environment-side channel: one JSON object per line.
 * The channel is a Unix socket mounted into the environment — deliberately not
 * routable, which is part of the no-raw-network claim (AC-M1.1).
 */
export interface InvokeRequest {
  op: 'invoke';
  request_type: string;
  payload: unknown;
}

export type InvokeResponse =
  | { ok: true; crossing: string; result: unknown }
  | { ok: false; crossing: string; verdict: 'deny'; reason: DenyReason };

export interface EchoPayload {
  message: string;
}

/**
 * The egress bridge, plus the platform side of the harness in M1: the declared
 * request-type check (AC-M1.4) runs here, on the platform side of the channel,
 * because a record written from inside the environment could not be trusted to
 * exist (AC-M1.5). Identity on events is stamped from the topology and the
 * runtime's own identifiers, never from anything the environment claims.
 */
export class Bridge {
  private crossings = 0;
  private server: Server | null = null;

  constructor(
    private readonly environment: EnvironmentDecl,
    private readonly bridge: BridgeDecl,
    private readonly journal: Journal,
    private readonly turn: string,
    private readonly identity: { application_instance: string; activation: string },
  ) {}

  async listen(socketPath: string): Promise<void> {
    const server = createServer((socket) => this.serve(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  private serve(socket: Socket): void {
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

  private handleLine(line: string): InvokeResponse {
    let request: InvokeRequest;
    try {
      request = JSON.parse(line) as InvokeRequest;
    } catch {
      request = { op: 'invoke', request_type: 'unparseable', payload: null };
    }
    return this.invoke(request);
  }

  invoke(request: InvokeRequest): InvokeResponse {
    this.crossings += 1;
    const crossing = `x-${this.crossings}`;
    const requestDigest = digestOf(request.payload);
    const bridgeName = this.bridge.name;
    const common = {
      crossing,
      bridge: bridgeName,
      request_type: request.request_type,
      request_digest: requestDigest,
    };
    const requester: Principal = {
      kind: 'agent-instance',
      application_instance: this.identity.application_instance,
      environment: this.environment.name,
      activation: this.identity.activation,
      turn: this.turn,
    };
    const bridgePrincipal: Principal = { kind: 'bridge', bridge: bridgeName };

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

    const result = { echoed: (request.payload as EchoPayload).message };
    this.journal.emit({
      event: 'crossing.performed',
      principal: bridgePrincipal,
      turn: this.turn,
      ...common,
      result_digest: digestOf(result),
    });
    return { ok: true, crossing, result };
  }

  private decide(request: InvokeRequest): { allow: true } | { allow: false; reason: DenyReason } {
    if (!this.environment.request_types.includes(request.request_type)) {
      return { allow: false, reason: 'request-type-undeclared' };
    }
    const decl = this.bridge.request_types.find((rt) => rt.name === request.request_type);
    if (!decl) {
      return { allow: false, reason: 'request-type-undeclared' };
    }
    if (decl.policy.kind === 'allow-all') {
      return { allow: true };
    }
    const payload = request.payload;
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload) ||
      typeof (payload as Record<string, unknown>).message !== 'string' ||
      Object.keys(payload).length !== 1
    ) {
      return { allow: false, reason: 'payload-schema-violation' };
    }
    const bytes = Buffer.byteLength((payload as EchoPayload).message, 'utf8');
    if (bytes > decl.policy.max_message_bytes) {
      return { allow: false, reason: 'payload-size-exceeded' };
    }
    return { allow: true };
  }
}
