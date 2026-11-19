import { InvalidGameInputError } from "../errors";

/** A 128-bit seed: 32 lowercase hex characters (game-engine.md section 6). */
export const SEED_PATTERN = /^[0-9a-f]{32}$/;

export interface Random {
  /** Next unsigned 32-bit integer. */
  nextUint32(): number;
  /** Uniform integer in [0, bound), without modulo bias. */
  nextInt(bound: number): number;
}

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

/** xoshiro128** seeded from a 128-bit hex seed. An all-zero state is replaced so the generator never sticks. */
export function createRandom(seed: string): Random {
  if (!SEED_PATTERN.test(seed)) {
    throw new InvalidGameInputError("Seed must be 32 lowercase hex characters");
  }
  const s = [0, 8, 16, 24].map((offset) => Number.parseInt(seed.slice(offset, offset + 8), 16));
  let [s0 = 0, s1 = 0, s2 = 0, s3 = 0] = s;
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1;
  const nextUint32 = (): number => {
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    return result;
  };
  const nextInt = (bound: number): number => {
    const limit = 2 ** 32 - (2 ** 32 % bound);
    let value = nextUint32();
    while (value >= limit) value = nextUint32();
    return value % bound;
  };
  return { nextUint32, nextInt };
}

/** Fisher-Yates shuffle in place. */
export function shuffle(items: string[], random: Random): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = random.nextInt(i + 1);
    const a = items[i] as string;
    items[i] = items[j] as string;
    items[j] = a;
  }
}
