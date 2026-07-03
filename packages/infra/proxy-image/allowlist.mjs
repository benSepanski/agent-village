// Pure, unit-testable helpers for the transparent egress proxy: hostname
// allowlist matching plus the two protocol sniffers (TLS SNI, HTTP Host).
// Kept dependency-free so proxy.mjs stays a thin runtime shell around these.

/**
 * Case-insensitive hostname allowlist match. Each pattern is either an exact
 * bare domain (`api.notion.com`) or a leading-wildcard (`*.example.com`) that
 * matches any single-or-multi-label subdomain but NOT the apex. Mirrors the
 * EgressDomain semantics in packages/shared/src/schemas/manifest.ts.
 * @param {string} host
 * @param {readonly string[]} patterns
 * @returns {boolean}
 */
export function isHostAllowed(host, patterns) {
  if (!host) return false;
  const target = host.toLowerCase().replace(/\.$/, '');
  for (const raw of patterns) {
    const pattern = raw.trim().toLowerCase();
    if (!pattern) continue;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // ".example.com"
      if (target.endsWith(suffix) && target.length > suffix.length) return true;
    } else if (target === pattern) {
      return true;
    }
  }
  return false;
}

/** Parse a comma-separated allowlist env value into a trimmed, non-empty list. */
export function parseAllowlist(value) {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const TLS_HANDSHAKE = 0x16;
const TLS_CLIENT_HELLO = 0x01;
const EXT_SERVER_NAME = 0x0000;
const SNI_HOST_NAME = 0x00;

/**
 * Extract the SNI server name from a TLS ClientHello record, or null if the
 * buffer is not a ClientHello or carries no host_name SNI entry. Tolerant of
 * short/truncated buffers (returns null rather than throwing).
 * @param {Buffer} buf
 * @returns {string | null}
 */
export function parseSni(buf) {
  try {
    if (buf.length < 43 || buf[0] !== TLS_HANDSHAKE || buf[5] !== TLS_CLIENT_HELLO) return null;
    let p = 43; // record(5) + handshake header(4) + version(2) + random(32)
    p += 1 + buf[p]; // session id
    p += 2 + buf.readUInt16BE(p); // cipher suites
    p += 1 + buf[p]; // compression methods
    if (p + 2 > buf.length) return null;
    return walkExtensions(buf, p + 2, p + 2 + buf.readUInt16BE(p));
  } catch {
    return null;
  }
}

/** Walk the TLS extensions block looking for the server_name (SNI) extension. */
function walkExtensions(buf, start, extEnd) {
  let p = start;
  while (p + 4 <= buf.length && p + 4 <= extEnd) {
    const type = buf.readUInt16BE(p);
    const len = buf.readUInt16BE(p + 2);
    const body = p + 4;
    if (type === EXT_SERVER_NAME) return readSniExtension(buf, body, len);
    p = body + len;
  }
  return null;
}

/** Read the first host_name entry from a server_name extension body. */
function readSniExtension(buf, body, len) {
  if (body + 5 > buf.length) return null;
  // server_name_list length (2) then entries: type(1) + name_len(2) + name.
  let q = body + 2;
  const end = Math.min(body + len, buf.length);
  while (q + 3 <= end) {
    const nameType = buf[q];
    const nameLen = buf.readUInt16BE(q + 1);
    const nameStart = q + 3;
    if (nameStart + nameLen > buf.length) return null;
    if (nameType === SNI_HOST_NAME) return buf.toString('utf8', nameStart, nameStart + nameLen);
    q = nameStart + nameLen;
  }
  return null;
}

/**
 * Extract the Host header value (without port) from the head of a plaintext
 * HTTP/1.x request, or null if there is no Host header.
 * @param {Buffer} buf
 * @returns {string | null}
 */
export function parseHttpHost(buf) {
  const text = buf.toString('latin1');
  const headerEnd = text.indexOf('\r\n\r\n');
  const scope = headerEnd === -1 ? text : text.slice(0, headerEnd);
  const match = /\r\nhost:[ \t]*([^\r\n]+)/i.exec(`\r\n${scope}`);
  if (!match) return null;
  return match[1].trim().replace(/:\d+$/, '');
}
