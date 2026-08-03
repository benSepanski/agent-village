# Recipe: Partial email agent (IMAP + SMTP)

An agent that reads and sends emails via IMAP and SMTP, using **implicit-TLS
ports only** (no STARTTLS). The platform's egress proxy enforces port
restrictions to ensure secure, encrypted connections.

## What the agent can do

- Read emails via IMAP (port 993) — the implicit-TLS port.
- Send emails via SMTP (port 465) — the implicit-SMTPS port.
- Process email content with Claude (extract, summarize, respond, etc.).

## What the agent cannot do

- Use STARTTLS (plaintext-to-TLS upgrade, ports 143/587).
- Use plaintext IMAP/SMTP.
- Access mail servers not in the allowlist.
- Relay emails to arbitrary recipients (limited by SMTP auth).

**Constraint**: The platform's egress proxy only supports implicit-TLS (TLS
negotiated immediately on connection). STARTTLS (starting plaintext then
upgrading) is not supported. Most mail clients support both; choose the
implicit-TLS variant.

Use case: a weekly mail digest that reads the past week's emails and generates
an AI-powered summary; or an auto-responder that processes incoming mail.

---

## Example structure

Located in `examples/gmail-agent/` (and referenced by the [email-partial
recipe](#recipe-partial-email-agent-imap--smtp)):

```
gmail-agent/
├── manifest.json       # egressAllow: [imap.gmail.com, smtp.gmail.com, registry.npmjs.org]
├── gmail-agent.mjs     # The agent code (reads/sends via IMAP/SMTP)
├── package.json        # Runtime deps: imapflow, mailparser, nodemailer, @anthropic-ai/sdk
├── package-lock.json   # Committed so the in-sandbox `npm ci` is reproducible
└── README.md           # Application README
```

This is a real, runnable app (not a manifest-only recipe) — see
[`examples/gmail-agent`](../../examples/gmail-agent/)'s README for the full
walkthrough, including `agent.json`.

## The manifest and grants

### manifest.json (Gmail example, from `examples/gmail-agent/manifest.json`)

```json
{
  "name": "gmail-agent",
  "image": "sandbox-base",
  "command": [
    "bash",
    "-c",
    "cp -R /workspace/gmail-agent /tmp/app && cd /tmp/app && npm ci --omit=dev --no-audit --no-fund && node gmail-agent.mjs"
  ],
  "schedule": "cron(0/15 * * * ? *)",
  "timeoutMinutes": 10,
  "egressAllow": ["imap.gmail.com", "smtp.gmail.com", "registry.npmjs.org"],
  "grants": [{ "kind": "secret", "name": "gmail-app-password", "env": "GMAIL_APP_PASSWORD" }],
  "env": {
    "GMAIL_ADDRESS": "my-agent@gmail.com",
    "GMAIL_ALLOWED_SENDERS": "me@example.com,teammate@example.com"
  },
  "flushIntervalSeconds": 0
}
```

Key points:

- **`egressAllow`** lists the mail server hostnames, plus `registry.npmjs.org`
  since this app has real npm dependencies installed in-sandbox at run time
  (`command` runs `npm ci`) — commit a `package-lock.json` before your first
  run or `npm ci` fails; `village init` does not generate one for you.
- **Ports 993 (IMAPS) and 465 (SMTPS)** are the only valid mail ports; 143
  (IMAP) and 587 (SMTP STARTTLS) are blocked.
- **`grants`** — a generic `secret` grant injects the Gmail app password as
  `GMAIL_APP_PASSWORD`.
- **`image: "sandbox-base"`** — the default Node.js sandbox image.

### Port mapping (implicit-TLS only)

| Protocol             | Port    | Supported | Notes                                                    |
| -------------------- | ------- | --------- | -------------------------------------------------------- |
| IMAP (plaintext)     | 143     | ❌ No     | Insecure; STARTTLS is not supported by the proxy         |
| IMAPS (implicit-TLS) | 993     | ✅ Yes    | Use this for Gmail, Outlook, most providers              |
| SMTP (plaintext)     | 25, 587 | ❌ No     | 25 is open relay risk; 587 uses STARTTLS (not supported) |
| SMTPS (implicit-TLS) | 465     | ✅ Yes    | Use this for sending mail                                |

### Getting credentials (Gmail example)

1. **Enable "App passwords"** in Google Account settings.
2. Create an app-specific password (not your main Google password).
3. Store it via the CLI:

   ```bash
   village secrets set <agentId> gmail-password --value "xxxx xxxx xxxx xxxx"
   ```

For other mail providers (Outlook, etc.), check their documentation for how to
enable IMAP/SMTP and generate an app password.

---

## Connectivity verification

### Allow-path tests

**Location**: `packages/services/src/sandbox-egress.test.ts` (derivation test)

Tests that `buildEgressAllowlist(manifest, region, workspaceBucket, [gatewayHost])`
produces a list containing:

- `imap.gmail.com` and `smtp.gmail.com` (from the manifest)
- The gateway host and AWS base domains (always present)

The proxy's `isHostAllowed()` confirms both mail servers are reachable.

**Location**: `packages/infra/test/proxy-allowlist.test.ts` (enforcement tests)

Tests that:

1. **IMAPS (port 993) is allowed**: `resolveTarget(clientHelloSNI('imap.gmail.com'), 993)`
   returns the target host, confirming the connection is permitted.

2. **SMTPS (port 465) is allowed**: `resolveTarget(clientHelloSNI('smtp.gmail.com'), 465)`
   returns the target host.

### Deny-path tests

**Location**: `packages/infra/test/proxy-allowlist.test.ts` (enforcement tests)

Tests that:

1. **IMAP plaintext (port 143) is blocked**: The port 143 is **not** in
   `SUPPORTED_PORTS`, so `resolveTarget(…, 143)` returns `null`, confirming
   the connection is rejected.

2. **SMTP STARTTLS (port 587) is blocked**: Port 587 is **not** in
   `SUPPORTED_PORTS`, so `resolveTarget(…, 587)` returns `null`.

3. **Off-list mail hosts are blocked**: `isHostAllowed('mail.evil.example.com', allowlist)`
   returns `false` — an agent cannot reach unauthorized mail servers.

4. **Plaintext upgrade is rejected**: A server speaking plaintext SMTP
   (no TLS SNI) attempting to STARTTLS is unclassifiable and blocked.

---

## Testing locally

Run the allow/deny tests:

```bash
# Derivation test (does the allowlist include imap/smtp hosts?)
pnpm --filter @agent-village/services test -- sandbox-egress

# Enforcement tests (are ports 143/587 blocked, and 993/465 allowed?)
pnpm --filter @agent-village/infra test -- proxy-allowlist
```

Both must pass for the recipe to be production-ready.

---

## Common issues

**"Connection refused" or "Connection timed out"**

Check that you're using the implicit-TLS ports:

- IMAP: port **993** (not 143)
- SMTP: port **465** (not 587)

Most mail client libraries let you configure the port and TLS mode:

```javascript
// Node.js example using imap library
const imap = new IMAP({
  user: 'your@gmail.com',
  password: process.env.GMAIL_APP_PASSWORD,
  host: 'imap.gmail.com',
  port: 993, // Implicit-TLS port
  tls: true, // Enable TLS immediately
  tlsOptions: { rejectUnauthorized: true },
});
```

**"SSL/TLS error" or "certificate mismatch"**

Ensure the server certificate matches the hostname. This is standard TLS
validation and should work out of the box with most libraries.

---

## Next steps

- Adapt the gmail-agent example to your mail provider (Outlook, ProtonMail, etc.).
- Use Claude to process email content (summarize threads, draft responses, etc.).
- Schedule it to run daily or hourly via the `schedule` field.

See the [Notion](notion-read-only.md) recipe for a read-only API pattern or the
[Anthropic-only](anthropic-only.md) recipe for a simpler example.
