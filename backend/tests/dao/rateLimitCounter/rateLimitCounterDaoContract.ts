import { expect, it } from "vitest";
import type { RateLimitCounterDao } from "../../../src/dao/rateLimitCounter/rateLimitCounterDao";

/** The behavior every RateLimitCounterDao must have (data-model.md section 10). */
export function rateLimitCounterDaoContract(
  create: () => RateLimitCounterDao,
  id: (name: string) => string = (name) => name,
): void {
  it("counts up to the limit and then refuses, per counter", async () => {
    const dao = create();
    const key = `GUEST#${id("limit")}#MIN#2026-11-22T10:00`;
    expect(await dao.increment(key, 2, 1800000000)).toBe(true);
    expect(await dao.increment(key, 2, 1800000000)).toBe(true);
    expect(await dao.increment(key, 2, 1800000000)).toBe(false);
    expect(await dao.increment(`GUEST#${id("other")}#MIN#2026-11-22T10:00`, 2, 1800000000)).toBe(
      true,
    );
  });
}
