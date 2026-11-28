import { PlayerSchema, type Player } from "../../models/player";
import {
  PlayerExistsError,
  PlayerMissingError,
  TOUCH_INTERVAL_MS,
  type PlayerDao,
} from "./playerDao";

/** PlayerDao over a map; items pass the schema and reads return copies. */
export function createInMemoryPlayerDao(): PlayerDao {
  const items = new Map<string, Player>();
  const run = <T>(work: () => T): Promise<T> =>
    new Promise((resolve) => {
      resolve(work());
    });
  const stored = (playerId: string): Player => {
    const item = items.get(playerId);
    if (item === undefined) throw new PlayerMissingError(playerId);
    return item;
  };
  return {
    get: (playerId) =>
      run(() => {
        const item = items.get(playerId);
        return item === undefined ? null : structuredClone(item);
      }),
    create: (player) =>
      run(() => {
        if (items.has(player.playerId)) throw new PlayerExistsError(player.playerId);
        items.set(player.playerId, structuredClone(PlayerSchema.parse(player)));
      }),
    update: (playerId, changes, at, remove = []) =>
      run(() => {
        const dropped: ReadonlySet<string> = new Set(remove);
        const player = PlayerSchema.parse(
          Object.fromEntries(
            Object.entries({ ...stored(playerId), ...changes, updatedAt: at }).filter(
              ([field]) => !dropped.has(field),
            ),
          ),
        );
        items.set(playerId, structuredClone(player));
        return structuredClone(player);
      }),
    touch: (playerId, at, ttl) =>
      run(() => {
        const item = items.get(playerId);
        if (item === undefined) return false;
        if (at.getTime() - Date.parse(item.lastActiveAt) < TOUCH_INTERVAL_MS) return false;
        const stamp = at.toISOString();
        items.set(playerId, {
          ...item,
          lastActiveAt: stamp,
          updatedAt: stamp,
          ...(ttl === undefined ? {} : { ttl }),
        });
        return true;
      }),
    countGame: (playerId, window, limit, at, seed) =>
      run(() => {
        const item = items.get(playerId) ?? PlayerSchema.parse(seed);
        const current = item.gamesPlayed;
        const same =
          current?.period === window.period && current.windowStart === window.windowStart;
        const count = same ? current.count : 0;
        if (limit !== null && count >= limit) return null;
        const gamesPlayed = { ...window, count: count + 1 };
        items.set(playerId, { ...item, gamesPlayed, updatedAt: at });
        return { ...gamesPlayed };
      }),
    giveBackGame: (playerId, window, at) =>
      run(() => {
        const item = items.get(playerId);
        const current = item?.gamesPlayed;
        if (
          item === undefined ||
          current?.period !== window.period ||
          current.windowStart !== window.windowStart ||
          current.count === 0
        )
          return;
        items.set(playerId, {
          ...item,
          gamesPlayed: { ...current, count: current.count - 1 },
          updatedAt: at,
        });
      }),
    listForRollup: () =>
      run(() =>
        [...items.values()].map(({ kind, status, lastActiveAt, createdAt }) => ({
          kind,
          status,
          lastActiveAt,
          createdAt,
        })),
      ),
    listAllEmails: () =>
      run(() =>
        [...items.values()].flatMap((item) =>
          item.kind === "ACCOUNT" && item.emailKey !== undefined
            ? [
                {
                  emailKey: item.emailKey,
                  playerId: item.playerId,
                  status: item.status,
                  signInProviders: [...(item.signInProviders ?? [])],
                  createdAt: item.createdAt,
                },
              ]
            : [],
        ),
      ),
    listByEmail: (emailKey) =>
      run(() =>
        [...items.values()]
          .filter((item) => item.kind === "ACCOUNT" && item.emailKey === emailKey)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map((item) => ({
            playerId: item.playerId,
            status: item.status,
            signInProviders: [...(item.signInProviders ?? [])],
            createdAt: item.createdAt,
          })),
      ),
  };
}
