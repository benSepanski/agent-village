import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RAND_LEN = 16;
const MASK_5 = 31n;

function encodeBase32(value: bigint, length: number): string {
  let v = value;
  let out = '';
  for (let i = 0; i < length; i++) {
    out = ALPHABET.charAt(Number(v & MASK_5)) + out;
    v >>= 5n;
  }
  return out;
}

/** Crockford-base32 ULID (26 chars). 48-bit timestamp + 80-bit randomness. */
export function ulid(now: number = Date.now()): string {
  const ts = encodeBase32(BigInt(now), TIME_LEN);
  const bytes = randomBytes(10);
  let rand = 0n;
  for (const b of bytes) rand = (rand << 8n) | BigInt(b);
  return ts + encodeBase32(rand, RAND_LEN);
}
