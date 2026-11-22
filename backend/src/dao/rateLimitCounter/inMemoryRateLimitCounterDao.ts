import type { RateLimitCounter } from "../../models/rateLimitCounter";
import type { RateLimitCounterDao } from "./rateLimitCounterDao";

/** RateLimitCounterDao over a map, with the same condition as DynamoDB. */
export function createInMemoryRateLimitCounterDao(
  items: Map<string, RateLimitCounter> = new Map(),
): RateLimitCounterDao {
  return {
    increment: (counterKey, limit, ttl) =>
      new Promise((resolve) => {
        const current = items.get(counterKey);
        if (current !== undefined && current.count >= limit) {
          resolve(false);
          return;
        }
        items.set(counterKey, {
          counterKey,
          count: (current?.count ?? 0) + 1,
          ttl: current?.ttl ?? ttl,
        });
        resolve(true);
      }),
  };
}
