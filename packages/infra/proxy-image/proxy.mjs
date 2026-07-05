// Transparent egress proxy for the sandbox task. iptables (see entrypoint.sh)
// REDIRECTs the app container's outbound TCP here; we peek the first bytes to
// learn the destination hostname (TLS SNI or HTTP Host), match it against the
// per-run allowlist (AV_EGRESS_ALLOW), and either splice the connection to the
// real host or drop it. Pure parsing/matching lives in allowlist.mjs.
//
// Original-port recovery — design choice (Phase 3 step 04): Node exposes no
// getsockopt(), so reading SO_ORIGINAL_DST (option A) would require a
// native/ffi dependency. We use option B, port-mapped REDIRECT: entrypoint.sh
// installs one REDIRECT rule per supported original port (80→15080,
// 443→15443, 465→15465, 993→15993), the proxy listens on each mapped port,
// and the listener that accepted a connection identifies the original
// destination port. Every other TCP port hits the catch-all listener
// (AV_PROXY_PORT) and is denied — under option B the original destination is
// unrecoverable there.
//
// STARTTLS (SMTP 587 / IMAP 143) is unsupported: those are server-speaks-first
// protocols, so the client sends no bytes to peek a hostname from, and option
// B cannot recover the original destination IP for a blind passthrough. Apps
// must use the implicit-TLS ports instead (SMTPS 465, IMAPS 993).
import net from 'node:net';
import { SUPPORTED_PORTS, isHostAllowed, parseAllowlist, resolveTarget } from './allowlist.mjs';

const FALLBACK_PORT = Number(process.env['AV_PROXY_PORT'] ?? '15001');
const LISTEN_BASE = 15000; // listener for original port P is LISTEN_BASE + P
const TLS_HANDSHAKE = 0x16;
const MAX_HEAD_BYTES = 64 * 1024;
const HEAD_TIMEOUT_MS = 5000;

const allowlist = parseAllowlist(process.env['AV_EGRESS_ALLOW']);

function log(event, extra) {
  process.stdout.write(`${JSON.stringify({ event, service: 'egress-proxy', ...extra })}\n`);
}

function splice(client, target, head) {
  const upstream = net.connect(target.port, target.host, () => {
    upstream.write(head);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  const onError = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on('error', onError);
  upstream.on('error', onError);
}

/**
 * Have we buffered enough of the client's opening bytes to identify the host?
 * For TLS, wait for the full ClientHello record (5-byte header + record length)
 * so the SNI extension can't be split across TCP segments; for HTTP, wait for
 * the end of the header block. Bounded by MAX_HEAD_BYTES so we never wait forever.
 */
function headComplete(head) {
  if (head.length === 0) return false;
  if (head.length >= MAX_HEAD_BYTES) return true;
  if (head[0] === TLS_HANDSHAKE) {
    if (head.length < 5) return false;
    return head.length >= 5 + head.readUInt16BE(3);
  }
  return head.includes('\r\n\r\n');
}

function route(client, head, originalPort) {
  const target = resolveTarget(head, originalPort);
  if (!target) {
    log('sandbox.egress.denied', { reason: 'unparsable', originalPort });
    client.destroy();
    return;
  }
  if (!isHostAllowed(target.host, allowlist)) {
    log('sandbox.egress.denied', { host: target.host, port: target.port });
    client.destroy();
    return;
  }
  log('sandbox.egress.allowed', { host: target.host, port: target.port });
  splice(client, target, head);
}

function handleConnection(client, originalPort) {
  let head = Buffer.alloc(0);
  let decided = false;
  const decide = () => {
    if (decided) return;
    decided = true;
    clearTimeout(timer);
    client.removeListener('data', onData);
    client.pause(); // buffer further bytes until splice() pipes them upstream
    route(client, head, originalPort);
  };
  const onData = (chunk) => {
    head = head.length ? Buffer.concat([head, chunk]) : chunk;
    if (headComplete(head)) decide();
  };
  // Decide on whatever arrived if the client stalls before a full head.
  const timer = setTimeout(decide, HEAD_TIMEOUT_MS);
  client.on('data', onData);
  client.on('close', () => clearTimeout(timer));
  client.on('error', () => {
    clearTimeout(timer);
    client.destroy();
  });
}

function listen(server, port, extra) {
  server.maxConnections = 1024;
  server.listen(port, () => {
    log('sandbox.proxy.started', { port, allowCount: allowlist.length, ...extra });
  });
}

// One listener per supported original port (see the port map in the header)...
for (const originalPort of SUPPORTED_PORTS) {
  const server = net.createServer((client) => handleConnection(client, originalPort));
  listen(server, LISTEN_BASE + originalPort, { originalPort });
}

// ...plus the catch-all for every other destination port: deny immediately,
// since the original destination cannot be recovered under port-mapped REDIRECT.
const fallback = net.createServer((client) => {
  log('sandbox.egress.denied', { reason: 'unsupported_port' });
  client.destroy();
});
listen(fallback, FALLBACK_PORT, {});
