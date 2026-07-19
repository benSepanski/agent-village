import { createInterface } from 'node:readline/promises';

/** Prompt for a plain (echoed) line of input, e.g. an email address or MFA code. */
export async function promptText(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

// Control characters, spelled out by code point rather than as literal bytes
// in source (DEL / ETX are invisible and easy to mangle in an editor).
const DEL = String.fromCharCode(127);
const CTRL_C = String.fromCharCode(3);
const ENTER_CHARS = new Set(['\r', '\n']);
const BACKSPACE_CHARS = new Set([DEL, '\b']);

function applyChar(value: string, ch: string): string {
  if (BACKSPACE_CHARS.has(ch)) return value.slice(0, -1);
  return value + ch;
}

/**
 * Prompt for a line of input with the terminal echo suppressed (raw mode),
 * used for passwords. Falls back to a plain prompt when stdin isn't a TTY
 * (e.g. piped input in tests or non-interactive shells).
 */
export async function promptPassword(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return promptText(question);
  process.stdout.write(question);
  return new Promise((resolvePromise, reject) => {
    let value = '';
    const cleanup = (): void => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (chunk: Buffer): void => {
      for (const ch of chunk.toString('utf8')) {
        if (ENTER_CHARS.has(ch)) {
          cleanup();
          process.stdout.write('\n');
          resolvePromise(value);
          return;
        }
        if (ch === CTRL_C) {
          cleanup();
          reject(new Error('prompt aborted'));
          return;
        }
        value = applyChar(value, ch);
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
  });
}
