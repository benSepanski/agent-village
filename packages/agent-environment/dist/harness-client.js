import { createConnection } from 'node:net';
/**
 * The environment side of the harness: the only capability handed to the agent
 * instance. It can invoke request types over the mounted channel socket and
 * nothing else; declared-set enforcement and all recording happen on the
 * platform side (see bridge.ts).
 */
export class HarnessClient {
    socketPath;
    constructor(socketPath) {
        this.socketPath = socketPath;
    }
    async invoke(requestType, payload) {
        const request = { op: 'invoke', request_type: requestType, payload };
        return new Promise((resolve, reject) => {
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
                        resolve(JSON.parse(buffer.slice(0, newline)));
                    }
                    catch (cause) {
                        reject(cause instanceof Error ? cause : new Error(String(cause)));
                    }
                }
            });
            socket.on('error', reject);
        });
    }
}
//# sourceMappingURL=harness-client.js.map