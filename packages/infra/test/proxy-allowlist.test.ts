import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// The proxy pure helpers live in the image dir as ESM so proxy.mjs can import
// them at runtime; vitest imports the same module for isolated unit tests.
import {
  HTTP_PORT,
  SUPPORTED_PORTS,
  TLS_PORTS,
  isHostAllowed,
  parseAllowlist,
  parseHttpHost,
  parseSni,
  resolveTarget,
} from '../proxy-image/allowlist.mjs';

describe('isHostAllowed', () => {
  const allow = ['api.notion.com', '*.githubusercontent.com', 'S3.us-east-1.amazonaws.com'];

  it('matches an exact bare domain', () => {
    expect(isHostAllowed('api.notion.com', allow)).toBe(true);
  });

  it('is case-insensitive on both host and pattern', () => {
    expect(isHostAllowed('API.Notion.COM', allow)).toBe(true);
    expect(isHostAllowed('s3.us-east-1.amazonaws.com', allow)).toBe(true);
  });

  it('matches a leading *. wildcard subdomain but not the apex', () => {
    expect(isHostAllowed('raw.githubusercontent.com', allow)).toBe(true);
    expect(isHostAllowed('a.b.githubusercontent.com', allow)).toBe(true);
    expect(isHostAllowed('githubusercontent.com', allow)).toBe(false);
  });

  it('tolerates a trailing dot on the host', () => {
    expect(isHostAllowed('api.notion.com.', allow)).toBe(true);
  });

  it('denies unlisted hosts and empty input', () => {
    expect(isHostAllowed('evil.example.com', allow)).toBe(false);
    expect(isHostAllowed('', allow)).toBe(false);
    expect(isHostAllowed('api.notion.com', [])).toBe(false);
  });
});

describe('parseAllowlist', () => {
  it('splits, trims, and drops empties', () => {
    expect(parseAllowlist(' a.com , b.com ,, ')).toEqual(['a.com', 'b.com']);
    expect(parseAllowlist(undefined)).toEqual([]);
  });
});

/** Build a minimal but well-formed TLS ClientHello carrying an SNI host_name. */
function clientHelloWithSni(hostname: string): Buffer {
  const host = Buffer.from(hostname, 'utf8');
  const serverNameList = Buffer.concat([
    Buffer.from([0x00]), // name_type = host_name
    u16(host.length),
    host,
  ]);
  const sniExtBody = Buffer.concat([u16(serverNameList.length), serverNameList]);
  const extension = Buffer.concat([u16(0x0000), u16(sniExtBody.length), sniExtBody]);
  const extensions = Buffer.concat([u16(extension.length), extension]);
  const body = Buffer.concat([
    Buffer.from([0x03, 0x03]), // client_version
    Buffer.alloc(32), // random
    Buffer.from([0x00]), // session id len = 0
    u16(2),
    Buffer.from([0x00, 0x2f]), // cipher suites (1 suite)
    Buffer.from([0x01, 0x00]), // compression methods (null)
    extensions,
  ]);
  const handshake = Buffer.concat([Buffer.from([0x01]), u24(body.length), body]);
  return Buffer.concat([Buffer.from([0x16, 0x03, 0x01]), u16(handshake.length), handshake]);
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
}
function u24(n: number): Buffer {
  return Buffer.from([(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
}

describe('parseSni', () => {
  it('extracts the SNI server name from a ClientHello', () => {
    expect(parseSni(clientHelloWithSni('example.com'))).toBe('example.com');
    expect(parseSni(clientHelloWithSni('raw.githubusercontent.com'))).toBe(
      'raw.githubusercontent.com',
    );
  });

  it('returns null for non-handshake or truncated buffers', () => {
    expect(parseSni(Buffer.from('GET / HTTP/1.1\r\n'))).toBeNull();
    expect(parseSni(Buffer.alloc(10))).toBeNull();
  });
});

describe('parseHttpHost', () => {
  it('extracts the Host header (stripping the port)', () => {
    const req = Buffer.from('GET /x HTTP/1.1\r\nHost: api.example.com:80\r\n\r\n');
    expect(parseHttpHost(req)).toBe('api.example.com');
  });

  it('is header-name case-insensitive', () => {
    const req = Buffer.from('GET / HTTP/1.1\r\nhOsT: notion.so\r\n\r\n');
    expect(parseHttpHost(req)).toBe('notion.so');
  });

  it('returns null when there is no Host header', () => {
    expect(parseHttpHost(Buffer.from('GET / HTTP/1.1\r\n\r\n'))).toBeNull();
  });
});

describe('resolveTarget (port-mapped original-destination recovery)', () => {
  const hello = clientHelloWithSni('imap.gmail.com');
  const httpReq = Buffer.from('GET / HTTP/1.1\r\nHost: example.com\r\n\r\n');

  it('preserves the original port for TLS-with-SNI on every TLS port', () => {
    for (const port of TLS_PORTS) {
      expect(resolveTarget(hello, port)).toEqual({ host: 'imap.gmail.com', port });
    }
  });

  it('rejects TLS on the plaintext HTTP port', () => {
    expect(resolveTarget(hello, HTTP_PORT)).toBeNull();
  });

  it('classifies plaintext HTTP on port 80 only', () => {
    expect(resolveTarget(httpReq, HTTP_PORT)).toEqual({ host: 'example.com', port: 80 });
    expect(resolveTarget(httpReq, 443)).toBeNull();
    expect(resolveTarget(httpReq, 993)).toBeNull();
  });

  it('returns null for unclassifiable bytes on any port', () => {
    expect(resolveTarget(Buffer.alloc(0), 443)).toBeNull();
    expect(resolveTarget(Buffer.from('EHLO example.com\r\n'), 443)).toBeNull();
  });
});

// Connectivity recipes (M5, AC-6.1-6.5) — ENFORCEMENT layer. The DERIVATION
// layer (buildEgressAllowlist including each recipe's hosts) is covered in
// packages/services/src/sandbox-egress.test.ts; `infra` may not import from
// `services` (dependency-cruiser layering), so the lists below are plain
// literals mirroring what that derivation produces for each recipe.
describe('AC-6.2 notion-reader recipe (enforcement)', () => {
  const derived = ['api.notion.com', 'sts.us-east-1.amazonaws.com', 'logs.us-east-1.amazonaws.com'];

  it('allow: api.notion.com is reachable', () => {
    expect(isHostAllowed('api.notion.com', derived)).toBe(true);
  });

  it('deny: an off-list host is blocked', () => {
    expect(isHostAllowed('evil.example.com', derived)).toBe(false);
  });
});

describe('AC-6.3 partial-email recipe (enforcement)', () => {
  const derived = ['imap.gmail.com', 'smtp.gmail.com'];

  it('allow: IMAPS (993) and SMTPS (465) resolve and are allowed for the mail host', () => {
    for (const port of [993, 465] as const) {
      const target = resolveTarget(clientHelloWithSni('imap.gmail.com'), port);
      expect(target).toEqual({ host: 'imap.gmail.com', port });
      expect(isHostAllowed(target?.host ?? '', derived)).toBe(true);
    }
  });

  it('deny: STARTTLS ports 143/587 are not supported ports at all', () => {
    expect(SUPPORTED_PORTS).not.toContain(143);
    expect(SUPPORTED_PORTS).not.toContain(587);
  });

  it('deny: a plaintext server-speaks-first greeting on an implicit-TLS port is unclassifiable, not passed through', () => {
    // IMAP/SMTP STARTTLS servers speak plaintext first (e.g. an SMTP banner or
    // an EHLO reply) — there is no SNI/Host to peek at, so resolveTarget must
    // return null rather than guessing a target, on every supported TLS port.
    const plaintextGreeting = Buffer.from('220 mail.example.com ESMTP ready\r\n');
    for (const port of TLS_PORTS) {
      expect(resolveTarget(plaintextGreeting, port)).toBeNull();
    }
  });

  it('deny: an off-list mail host is blocked', () => {
    expect(isHostAllowed('imap.evil-mail.example.com', derived)).toBe(false);
  });
});

describe('AC-6.5 no new proxy features (recipe negative/contract)', () => {
  it('SUPPORTED_PORTS is exactly the implicit-TLS + plaintext-HTTP set — no STARTTLS ports added', () => {
    expect([...SUPPORTED_PORTS].sort((a, b) => a - b)).toEqual([80, 443, 465, 993]);
  });

  it('the proxy source carries no MCP or SSE transport handling', () => {
    const files = ['allowlist.mjs', 'proxy.mjs', 'entrypoint.sh'];
    for (const file of files) {
      const src = readFileSync(new URL(`../proxy-image/${file}`, import.meta.url), 'utf8');
      expect(src.toLowerCase()).not.toMatch(/\bmcp\b/);
      expect(src.toLowerCase()).not.toMatch(/\bsse\b|event-stream/);
    }
  });

  it('a plaintext STARTTLS greeting on an implicit-TLS port is never resolved to a target (no upgrade path added)', () => {
    const ehlo = Buffer.from('EHLO mail.example.com\r\n');
    expect(resolveTarget(ehlo, 587)).toBeNull();
    expect(resolveTarget(ehlo, 143)).toBeNull();
  });
});

describe('entrypoint.sh port map lockstep', () => {
  const script = readFileSync(new URL('../proxy-image/entrypoint.sh', import.meta.url), 'utf8');

  it('REDIRECTs exactly the supported original ports to their 15000+P listeners', () => {
    const loop = /for dport in ([0-9 ]+); do/.exec(script);
    expect(loop).not.toBeNull();
    const scriptPorts = (loop?.[1] ?? '')
      .trim()
      .split(/\s+/)
      .map(Number)
      .sort((a, b) => a - b);
    expect(scriptPorts).toEqual([...SUPPORTED_PORTS].sort((a, b) => a - b));
    expect(script).toContain('--to-ports "$((15000 + dport))"');
  });

  it('pins DNS exemptions to the task resolvers, never a blanket dport 53', () => {
    // A `--dport 53 -j RETURN` without a `-d <resolver>` would let the app open
    // a raw tunnel to port 53 on any host, bypassing the allowlist.
    expect(script).toContain('/^nameserver/ { print $2 }');
    expect(script).toMatch(/-d "\$ns" --dport 53 -j RETURN/);
    expect(script).not.toMatch(/^[^#\n]*-p (?:udp|tcp) --dport 53 -j RETURN/m);
  });

  it('writes the readiness marker the app container health check waits on', () => {
    // Lockstep with sandbox-stack.ts addProxyContainer healthCheck command.
    expect(script).toContain(': > /tmp/av-egress-ready');
  });
});
