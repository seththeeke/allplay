import { describe, expect, it } from "vitest";
import { createInMemoryRateLimitCounterDao } from "../../../src/dao/rateLimitCounter/inMemoryRateLimitCounterDao";
import type { RateLimitCounter } from "../../../src/models/rateLimitCounter";
import { createRateLimiter } from "../../../src/service/decision/rateLimiter";

describe("decision rate limiter", () => {
  it("admits up to the minute and day limits, in UTC windows that expire a day after they end", async () => {
    let now = new Date("2026-11-22T10:15:30.000Z");
    const items = new Map<string, RateLimitCounter>();
    const limiter = createRateLimiter(createInMemoryRateLimitCounterDao(items), () => now, {
      perMinute: 2,
      perDay: 3,
    });
    expect(await limiter.admit("GUEST#g")).toBe(true);
    expect(await limiter.admit("GUEST#g")).toBe(true);
    expect(await limiter.admit("GUEST#g")).toBe(false);
    expect(items.get("GUEST#g#MIN#2026-11-22T10:15")).toEqual({
      counterKey: "GUEST#g#MIN#2026-11-22T10:15",
      count: 2,
      ttl: Date.parse("2026-11-23T10:16:00.000Z") / 1000,
    });
    expect(items.get("GUEST#g#DAY#2026-11-22")?.ttl).toBe(
      Date.parse("2026-11-24T00:00:00.000Z") / 1000,
    );
    now = new Date("2026-11-22T10:16:01.000Z");
    expect(await limiter.admit("GUEST#g")).toBe(true);
    expect(await limiter.admit("GUEST#g")).toBe(false);
    expect(await limiter.admit("GUEST#other")).toBe(true);
    expect(await createRateLimiter(createInMemoryRateLimitCounterDao()).admit("GUEST#g")).toBe(
      true,
    );
  });
});
