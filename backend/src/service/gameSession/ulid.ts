import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A ULID: 48-bit millisecond time then 80 random bits, Crockford base32 (data-model.md section 1). */
export function newUlid(timeMs: number, random: Uint8Array = randomBytes(10)): string {
  let time = "";
  let t = timeMs;
  for (let i = 0; i < 10; i += 1) {
    time = (ALPHABET[t % 32] as string) + time;
    t = Math.floor(t / 32);
  }
  let bits = 0n;
  for (const byte of random) bits = (bits << 8n) | BigInt(byte);
  let rest = "";
  for (let i = 0; i < 16; i += 1) {
    rest = (ALPHABET[Number(bits & 31n)] as string) + rest;
    bits >>= 5n;
  }
  return time + rest;
}
