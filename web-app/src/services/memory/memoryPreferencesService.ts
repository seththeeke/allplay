import {
  DEFAULT_APP_PREFERENCES,
  DEFAULT_GAME_PREFERENCES,
  PreferencesResponseSchema,
  type PreferencesResponse,
} from "../../models/api";
import { mergeDefined } from "../mergeDefined";
import type { PreferencesService } from "../types";
import type { MemoryStore } from "./memoryStore";

const KEY = "allplay.memory.preferences";

export function createMemoryPreferencesService(store: MemoryStore): PreferencesService {
  const load = (): PreferencesResponse => {
    const parsed = PreferencesResponseSchema.safeParse(store.read<unknown>(KEY, null));
    return parsed.success ? parsed.data : { app: DEFAULT_APP_PREFERENCES, games: {} };
  };
  /*
   * Each update reads, merges, validates and writes in one step inside the
   * promise, so concurrent updates never overwrite each other and an invalid
   * patch rejects like a failed API call.
   */
  const update = (
    change: (current: PreferencesResponse) => PreferencesResponse,
  ): Promise<PreferencesResponse> =>
    Promise.resolve().then(() => {
      const validated = PreferencesResponseSchema.parse(change(load()));
      store.write(KEY, validated);
      return validated;
    });
  return {
    get: () => Promise.resolve(load()),
    patchApp: (patch) =>
      update((current) => ({ ...current, app: mergeDefined(current.app, patch) })),
    patchGame: (gameId, patch) =>
      update((current) => ({
        ...current,
        games: {
          ...current.games,
          [gameId]: mergeDefined(current.games[gameId] ?? DEFAULT_GAME_PREFERENCES, patch),
        },
      })),
  };
}
