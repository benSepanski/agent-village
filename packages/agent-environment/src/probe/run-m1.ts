import { lookup, resolve4, setServers } from 'node:dns';
import { createSocket } from 'node:dgram';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';

import { HarnessClient } from '../harness-client.js';

/**
 * The M1 probe agent: a script, not a model. It attempts every kind of raw
 * network reach the spec denies (AC-M1.1), inspects its own filesystem for any
 * journal path (AC-M1.5), and exercises the three crossing outcomes through
 * the harness (AC-M1.2 – AC-M1.4). Its stdout is the evidence the fixture
 * runner collects — deliberately not the journal, which it must not reach.
 */

const TIMEOUT_MS = 5000;

interface SweepAttempt {
  attempt: string;
  outcome: 'failed' | 'REACHED-NETWORK';
  detail: string;
}

function tcpAttempt(label: string, host: string, port: number): Promise<SweepAttempt> {
  return new Promise((done) => {
    const socket = createConnection({ host, port, family: host.includes(':') ? 6 : 4 });
    const finish = (outcome: SweepAttempt['outcome'], detail: string) => {
      socket.destroy();
      done({ attempt: label, outcome, detail });
    };
    socket.setTimeout(TIMEOUT_MS, () => finish('failed', 'timeout'));
    socket.on('connect', () => finish('REACHED-NETWORK', 'tcp connect succeeded'));
    socket.on('error', (err) => finish('failed', String(err)));
  });
}

function udpAttempt(label: string, host: string, port: number): Promise<SweepAttempt> {
  return new Promise((done) => {
    const socket = createSocket('udp4');
    // A minimal DNS query for example.com, so a response would prove real reach.
    const query = Buffer.from('000101000001000000000000076578616d706c6503636f6d0000010001', 'hex');
    const timer = setTimeout(() => {
      socket.close();
      done({ attempt: label, outcome: 'failed', detail: 'no response within timeout' });
    }, TIMEOUT_MS);
    socket.on('message', () => {
      clearTimeout(timer);
      socket.close();
      done({ attempt: label, outcome: 'REACHED-NETWORK', detail: 'udp response received' });
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      socket.close();
      done({ attempt: label, outcome: 'failed', detail: String(err) });
    });
    socket.send(query, port, host, (err) => {
      if (err) {
        clearTimeout(timer);
        socket.close();
        done({ attempt: label, outcome: 'failed', detail: `send: ${String(err)}` });
      }
    });
  });
}

function dnsResolveAttempt(label: string, servers: string[] | null): Promise<SweepAttempt> {
  return new Promise((done) => {
    if (servers) {
      try {
        setServers(servers);
      } catch (err) {
        done({ attempt: label, outcome: 'failed', detail: `setServers: ${String(err)}` });
        return;
      }
    }
    const timer = setTimeout(
      () => done({ attempt: label, outcome: 'failed', detail: 'timeout' }),
      TIMEOUT_MS,
    );
    resolve4('example.com', (err, addresses) => {
      clearTimeout(timer);
      if (err) {
        done({ attempt: label, outcome: 'failed', detail: String(err) });
      } else {
        done({
          attempt: label,
          outcome: 'REACHED-NETWORK',
          detail: `resolved ${addresses.join(',')}`,
        });
      }
    });
  });
}

function dnsLookupAttempt(label: string): Promise<SweepAttempt> {
  return new Promise((done) => {
    const timer = setTimeout(
      () => done({ attempt: label, outcome: 'failed', detail: 'timeout' }),
      TIMEOUT_MS,
    );
    lookup('example.com', (err, address) => {
      clearTimeout(timer);
      if (err) {
        done({ attempt: label, outcome: 'failed', detail: String(err) });
      } else {
        done({ attempt: label, outcome: 'REACHED-NETWORK', detail: `resolved ${address}` });
      }
    });
  });
}

/** Walks the container filesystem looking for anything journal-shaped (AC-M1.5). */
function findJournalPaths(root: string, matches: string[], depth: number): void {
  if (depth > 6) return;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(root, entry);
    if (['/proc', '/sys', '/dev'].includes(path)) continue;
    if (entry.toLowerCase().includes('journal')) matches.push(path);
    try {
      if (statSync(path).isDirectory()) findJournalPaths(path, matches, depth + 1);
    } catch {
      // unreadable entries are fine; we are looking for reachable journal paths
    }
  }
}

async function main(): Promise<void> {
  const sweep: SweepAttempt[] = [];
  sweep.push(await tcpAttempt('tcp4 1.1.1.1:80', '1.1.1.1', 80));
  sweep.push(await tcpAttempt('tcp4 8.8.8.8:443', '8.8.8.8', 443));
  sweep.push(await tcpAttempt('tcp6 [2606:4700:4700::1111]:80', '2606:4700:4700::1111', 80));
  sweep.push(await udpAttempt('udp4 1.1.1.1:53 dns query', '1.1.1.1', 53));
  sweep.push(await dnsLookupAttempt('dns lookup via system resolver'));
  sweep.push(await dnsResolveAttempt('dns resolve via 8.8.8.8', ['8.8.8.8']));
  sweep.push(await dnsResolveAttempt('dns resolve via docker embedded 127.0.0.11', ['127.0.0.11']));

  const journalPaths: string[] = [];
  findJournalPaths('/', journalPaths, 0);

  const harness = new HarnessClient('/bridge/bridge.sock');
  const invocations = {
    declared_allowed: await harness.invoke('probe.echo', { message: 'hello from the probe' }),
    declared_denied: await harness.invoke('probe.echo', { message: 'x'.repeat(4096) }),
    undeclared: await harness.invoke('probe.forbidden', { message: 'should never cross' }),
  };

  const report = {
    sweep,
    mounts: readFileSync('/proc/mounts', 'utf8'),
    bridge_dir: readdirSync('/bridge'),
    journal_paths_reachable: journalPaths,
    invocations,
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

main().catch((err: unknown) => {
  process.stdout.write(`${JSON.stringify({ probe_error: String(err) })}\n`);
  process.exitCode = 1;
});
