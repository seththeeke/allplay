import type { RateLimitCounterDao } from "../../dao/rateLimitCounter/rateLimitCounterDao";

/** Per-player limits on `POST /v1/decisions` (action-decision.md section 10). */
export const DECISION_LIMITS = { perMinute: 20, perDay: 600 } as const;

const DAY_SECONDS = 24 * 60 * 60;

export interface RateLimiter {
  /** Counts one decision for the player; false when a window is full. */
  admit(playerId: string): Promise<boolean>;
}

/**
 * Fixed windows in UTC: the minute and the day. Each counter expires a day
 * after its window ends (data-model.md section 10). The minute is checked
 * first, so a burst never spends the day's allowance.
 */
export function createRateLimiter(
  dao: RateLimitCounterDao,
  now: () => Date = () => new Date(),
  limits: { perMinute: number; perDay: number } = DECISION_LIMITS,
): RateLimiter {
  return {
    admit: async (playerId) => {
      const at = now();
      const seconds = Math.floor(at.getTime() / 1000);
      const minuteStart = seconds - (seconds % 60);
      const dayStart = seconds - (seconds % DAY_SECONDS);
      const minute = new Date(minuteStart * 1000).toISOString().slice(0, 16);
      const day = new Date(dayStart * 1000).toISOString().slice(0, 10);
      const inMinute = await dao.increment(
        `${playerId}#MIN#${minute}`,
        limits.perMinute,
        minuteStart + 60 + DAY_SECONDS,
      );
      if (!inMinute) return false;
      return dao.increment(`${playerId}#DAY#${day}`, limits.perDay, dayStart + 2 * DAY_SECONDS);
    },
  };
}
