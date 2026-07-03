// Transparent egress proxy for the sandbox task. iptables (see entrypoint.sh)
// REDIRECTs the app container's outbound TCP here; we peek the first bytes to
// learn the destination hostname (TLS SNI or HTTP Host), match it against the
// per-run allowlist (AV_EGRESS_ALLOW), and either splice the connection to the
// real host or drop it. Pure parsing/matching lives in allowlist.mjs.
import net from 'node:net';
import { isHostAllowed, parseAllowlist, parseHttpHost, parseSni } from './allowlist.mjs';

const LISTEN_PORT = Number(process.env['AV_PROXY_PORT'] ?? '15001');
const TLS_PORT = 443;
const HTTP_PORT = 80;
const TLS_HANDSHAKE = 0x16;
const MAX_HEAD_BYTES = 64 * 1024;
const HEAD_TIMEOUT_MS = 5000;

const allowlist = parseAllowlist(process.env['AV_EGRESS_ALLOW']);

function log(event, extra) {
  process.stdout.write(`${JSON.stringify({ event, service: 'egress-proxy', ...extra })}\n`);
}

/** Decide destination host+port from the first bytes of the client stream. */
function resolveTarget(head) {
  const sni = parseSni(head);
  if (sni) return { host: sni, port: TLS_PORT };
  const httpHost = parseHttpHost(head);
  if (httpHost) return { host: httpHost, port: HTTP_PORT };
  return null;
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

function route(client, head) {
  const target = resolveTarget(head);
  if (!target) {
    log('sandbox.egress.denied', { reason: 'unparsable' });
    client.destroy();
    return;
  }
  if (!isHostAllowed(target.host, allowlist)) {
    log('sandbox.egress.denied', { host: target.host });
    client.destroy();
    return;
  }
  log('sandbox.egress.allowed', { host: target.host });
  splice(client, target, head);
}

function handleConnection(client) {
  let head = Buffer.alloc(0);
  let decided = false;
  const decide = () => {
    if (decided) return;
    decided = true;
    clearTimeout(timer);
    client.removeListener('data', onData);
    client.pause(); // buffer further bytes until splice() pipes them upstream
    route(client, head);
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

const server = net.createServer(handleConnection);
server.maxConnections = 1024;
server.listen(LISTEN_PORT, () => {
  log('sandbox.proxy.started', { port: LISTEN_PORT, allowCount: allowlist.length });
});
