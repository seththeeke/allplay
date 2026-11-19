import { describe, expect, it } from "vitest";
import { boundedInt, createRandom, shuffle } from "../../src/game-engine/random/xoshiro";

describe("seeded random", () => {
  it("is deterministic for a seed and differs across seeds", () => {
    const a = createRandom("0123456789abcdef0123456789abcdef");
    const b = createRandom("0123456789abcdef0123456789abcdef");
    const c = createRandom("fedcba9876543210fedcba9876543210");
    const seqA = Array.from({ length: 5 }, () => a.nextUint32());
    expect(seqA).toEqual(Array.from({ length: 5 }, () => b.nextUint32()));
    expect(seqA).not.toEqual(Array.from({ length: 5 }, () => c.nextUint32()));
    expect(seqA.every((n) => Number.isInteger(n) && n >= 0 && n < 2 ** 32)).toBe(true);
  });

  it("never sticks on an all-zero seed", () => {
    const random = createRandom("00000000000000000000000000000000");
    const values = new Set(Array.from({ length: 10 }, () => random.nextUint32()));
    expect(values.size).toBeGreaterThan(1);
  });

  it("rejects malformed seeds", () => {
    expect(() => createRandom("XYZ")).toThrow(/32 lowercase hex/);
    expect(() => createRandom("0123456789ABCDEF0123456789ABCDEF")).toThrow(/32 lowercase hex/);
  });

  it("draws bounded integers without bias by rejecting the top of the range", () => {
    const random = createRandom("00000000000000000000000000000001");
    const seen = new Set(Array.from({ length: 300 }, () => random.nextInt(3)));
    expect([...seen].sort()).toEqual([0, 1, 2]);
    const draws = [2 ** 32 - 1, 7];
    expect(boundedInt(() => draws.shift() ?? 0, 3)).toBe(1);
  });

  it("shuffles into a deterministic permutation", () => {
    const items = ["a", "b", "c", "d", "e"];
    const once = [...items];
    const twice = [...items];
    shuffle(once, createRandom("00000000000000000000000000000003"));
    shuffle(twice, createRandom("00000000000000000000000000000003"));
    expect(once).toEqual(twice);
    expect([...once].sort()).toEqual(items);
  });
});
