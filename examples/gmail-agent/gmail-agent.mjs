// examples/gmail-agent — agent-village reference application (Phase 3 step 08).
//
// Proves the platform contract with ZERO platform changes: a plain Node script
// synced in via the S3 workspace, installed with `npm ci` inside the sandbox
// (registry.npmjs.org in `egressAllow`), running on the static base image via
// `manifest.command`. See README.md for setup.
//
// One run = one poll cycle:
//   1. IMAPS (imap.gmail.com:993) — fetch messages newer than the persisted
//      seen state (a UID watermark stored in the synced workspace directory),
//   2. draft a reply per message through the platform's metered Anthropic
//      gateway (the SDK honors the per-run ANTHROPIC_BASE_URL and
//      ANTHROPIC_API_KEY the launcher injects — no code changes needed),
//   3. send the reply via SMTPS (smtp.gmail.com:465),
//   4. advance the watermark, exit.
//
// Application-level guards (policy stays in the app, not the platform):
//   - sender allowlist from GMAIL_ALLOWED_SENDERS (fail-closed: required),
//   - machine-generated mail is never answered (Auto-Submitted, Precedence
//     bulk/junk/list, X-Auto-Response-Suppress, List-Id) and neither is our
//     own address,
//   - outgoing replies carry `Auto-Submitted: auto-replied` (RFC 3834) so
//     other auto-responders — including future runs of this script — never
//     answer them,
//   - the UID watermark is persisted BEFORE each send — at-most-once within a
//     run; the watermark only becomes durable at the entrypoint's final S3
//     sync, so a hard kill (watchdog SIGKILL, host failure) or failed sync can
//     replay a batch on the next run,
//   - at most GMAIL_MAX_REPLIES replies per run, and the very first run only
//     baselines the watermark — the existing backlog is never answered.
//
// The egress proxy does not support STARTTLS (SMTP 587 / IMAP 143), so this
// app uses the implicit-TLS ports Gmail also supports (SMTPS 465, IMAPS 993).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';

const IMAP_HOST = 'imap.gmail.com';
const IMAP_PORT = 993;
const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 465;
// Most capable model priced by the platform's metering gateway (the gateway
// rejects model ids it cannot price — see services/anthropic-gateway.ts).
const DEFAULT_MODEL = 'claude-opus-4-8';
const MAX_REPLY_TOKENS = 1024;
const BODY_CHAR_LIMIT = 4000;
const DEFAULT_MAX_REPLIES = 5;

// Machine-generated mail markers (RFC 3834 + common conventions). Note that
// `Auto-Submitted: no` explicitly marks human mail, so it must NOT match.
const SUPPRESS_HEADER_RE =
  /^(?:auto-submitted:(?!\s*no\b)|precedence:\s*(?:bulk|junk|list|auto_reply)|x-auto-response-suppress:|list-id:)/im;

function log(event, extra) {
  process.stdout.write(`${JSON.stringify({ event, service: 'gmail-agent', ...extra })}\n`);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

function readConfig() {
  const senders = requireEnv('GMAIL_ALLOWED_SENDERS')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  // The base-image entrypoint syncs the durable workspace to /workspace
  // (AV_WORKSPACE_DIR override supported for local testing).
  const workspaceDir = process.env['AV_WORKSPACE_DIR'] ?? '/workspace';
  return {
    address: requireEnv('GMAIL_ADDRESS').trim().toLowerCase(),
    password: requireEnv('GMAIL_APP_PASSWORD'),
    allowedSenders: new Set(senders),
    model: process.env['GMAIL_AGENT_MODEL'] ?? DEFAULT_MODEL,
    maxReplies: Number(process.env['GMAIL_MAX_REPLIES'] ?? DEFAULT_MAX_REPLIES),
    stateFile: path.join(workspaceDir, 'gmail-agent', 'state.json'),
  };
}

async function loadState(stateFile) {
  try {
    const parsed = JSON.parse(await readFile(stateFile, 'utf8'));
    if (Number.isInteger(parsed.uidValidity) && Number.isInteger(parsed.lastUid)) return parsed;
  } catch {
    // Missing or unreadable state → baseline below.
  }
  return null;
}

async function saveState(stateFile, state) {
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(state)}\n`, 'utf8');
}

/**
 * First run, or Gmail reissued UIDs (UIDVALIDITY changed): return a fresh
 * watermark at the current end of the mailbox so the backlog is never
 * answered. Returns null when the persisted state is still valid.
 */
function baselinedState(mailbox, state) {
  const uidValidity = Number(mailbox.uidValidity);
  if (state && state.uidValidity === uidValidity) return null;
  return { uidValidity, lastUid: Number(mailbox.uidNext) - 1 };
}

/** Returns a skip reason for mail this agent must not answer, else null. */
function skipReason(msg, config) {
  const sender = msg.envelope?.from?.[0]?.address?.toLowerCase();
  if (!sender) return 'no_sender';
  if (sender === config.address) return 'own_address';
  if (!config.allowedSenders.has(sender)) return 'sender_not_allowed';
  if (SUPPRESS_HEADER_RE.test(String(msg.headers ?? ''))) return 'auto_generated';
  return null;
}

async function fetchNewMessages(client, lastUid) {
  const messages = [];
  const query = {
    uid: true,
    envelope: true,
    source: true,
    headers: ['auto-submitted', 'precedence', 'x-auto-response-suppress', 'list-id'],
  };
  // IMAP normalizes `<n>:*` to include the highest-UID message even when n
  // exceeds it, so the watermark filter below is load-bearing.
  for await (const msg of client.fetch(`${lastUid + 1}:*`, query, { uid: true })) {
    if (msg.uid > lastUid) messages.push(msg);
  }
  messages.sort((a, b) => a.uid - b.uid);
  return messages;
}

async function draftReply(anthropic, config, msg, bodyText) {
  const from = msg.envelope.from[0];
  const response = await anthropic.messages.create({
    model: config.model,
    max_tokens: MAX_REPLY_TOKENS,
    system: [
      `You draft short, courteous email replies on behalf of ${config.address}.`,
      "Reply directly to the sender's message in plain text. Output only the",
      'reply body — no subject line, no signature placeholder, no preamble.',
    ].join(' '),
    messages: [
      {
        role: 'user',
        content: [
          `From: ${from.name ?? ''} <${from.address}>`,
          `Subject: ${msg.envelope.subject ?? '(no subject)'}`,
          '',
          bodyText.slice(0, BODY_CHAR_LIMIT),
        ].join('\n'),
      },
    ],
  });
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('model returned an empty reply');
  return text;
}

function replySubject(subject) {
  const base = (subject ?? '').trim();
  return /^re:/i.test(base) ? base : `Re: ${base}`.trim();
}

async function sendReply(transport, config, msg, replyText) {
  const envelope = msg.envelope;
  await transport.sendMail({
    from: config.address,
    to: envelope.from[0].address,
    subject: replySubject(envelope.subject),
    text: replyText,
    inReplyTo: envelope.messageId,
    references: envelope.messageId,
    headers: {
      // Loop suppression (RFC 3834): mark our replies as auto-generated.
      'Auto-Submitted': 'auto-replied',
      'X-Auto-Response-Suppress': 'All',
    },
  });
}

/** Handles one inbox message; returns true when a reply was sent. */
async function processMessage(ctx, msg) {
  const { config, anthropic, transport, state } = ctx;
  state.lastUid = Math.max(state.lastUid, msg.uid);
  const reason = skipReason(msg, config);
  if (reason) {
    log('gmail.message.skipped', { uid: msg.uid, reason });
    return false;
  }
  const parsed = await simpleParser(msg.source);
  const replyText = await draftReply(anthropic, config, msg, (parsed.text ?? '').trim());
  // Persist the watermark BEFORE sending: a crash between save and send loses
  // at most one reply, while the reverse order could reply in a loop forever.
  await saveState(config.stateFile, state);
  await sendReply(transport, config, msg, replyText);
  log('gmail.message.replied', { uid: msg.uid, to: msg.envelope.from[0].address });
  return true;
}

async function replyToNew(client, ctx) {
  const messages = await fetchNewMessages(client, ctx.state.lastUid);
  log('gmail.poll.fetched', { count: messages.length });
  let replies = 0;
  for (const msg of messages) {
    if (replies >= ctx.config.maxReplies) {
      log('gmail.poll.reply_cap_reached', { cap: ctx.config.maxReplies });
      break;
    }
    if (await processMessage(ctx, msg)) replies += 1;
  }
  await saveState(ctx.config.stateFile, ctx.state);
  log('gmail.poll.done', { replies, lastUid: ctx.state.lastUid });
}

async function main() {
  const config = readConfig();
  const state = await loadState(config.stateFile);
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: config.address, pass: config.password },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const fresh = baselinedState(client.mailbox, state);
    if (fresh) {
      await saveState(config.stateFile, fresh);
      log('gmail.state.baselined', fresh);
      return;
    }
    const transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: true,
      auth: { user: config.address, pass: config.password },
    });
    await replyToNew(client, { config, state, anthropic: new Anthropic(), transport });
  } finally {
    lock.release();
    await client.logout();
  }
}

main().catch((err) => {
  log('gmail.run.failed', { error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});
