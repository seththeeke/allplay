/** RateLimitCounter persistence (data-model.md section 10). */
export interface RateLimitCounterDao {
  /**
   * Adds one to the counter when it is below `limit`, creating it with `ttl`;
   * false, and no change, when the window is already full.
   */
  increment(counterKey: string, limit: number, ttl: number): Promise<boolean>;
}
