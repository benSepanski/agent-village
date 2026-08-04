import { createConnection } from 'node:net';

import type { InvokeRequest, InvokeResponse } from './bridge.js';

/**
 * The environment side of the harness: the only capability handed to the agent
 * instance. It can invoke request types over the mounted channel socket and
 * nothing else; declared-set enforcement and all recording happen on the
 * platform side (see bridge.ts).
 */
export class HarnessClient {
  constructor(private readonly socketPath: string) {}

  async invoke(requestType: string, payload: unknown): Promise<InvokeResponse> {
    const request: InvokeRequest = { op: 'invoke', request_type: requestType, payload };
    return new Promise<InvokeResponse>((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      let buffer = '';
      socket.on('connect', () => {
        socket.write(`${JSON.stringify(request)}\n`);
      });
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const newline = buffer.indexOf('\n');
        if (newline >= 0) {
          socket.end();
          try {
            resolve(JSON.parse(buffer.slice(0, newline)) as InvokeResponse);
          } catch (cause) {
            reject(cause instanceof Error ? cause : new Error(String(cause)));
          }
        }
      });
      socket.on('error', reject);
    });
  }
}
