import type { AppConfig } from "../config";
import { createLiveHealthService } from "./live/liveHealthService";
import { createMemoryAdminService } from "./memory/memoryAdminService";
import { createMemoryDecisionService } from "./memory/memoryDecisionService";
import { createMemoryGameService } from "./memory/memoryGameService";
import { memoryHealthService } from "./memory/memoryHealthService";
import { createMemoryPlayerService } from "./memory/memoryPlayerService";
import { createMemorySessionService } from "./memory/memorySessionService";
import { createMemoryPreferencesService } from "./memory/memoryPreferencesService";
import { readStats } from "./memory/memoryStats";
import { createMemoryStore, type MemoryStore } from "./memory/memoryStore";
import type { Services } from "./types";

/**
 * Builds every service for the configured data mode. Live services arrive in
 * phase 7 (WP-1); the health check is live already whenever the stage config
 * has an API URL (prototype-mocks.md section 3).
 */
export function createServices(
  config: AppConfig,
  store: MemoryStore = createMemoryStore(),
  seed: () => number = () => Math.floor(Math.random() * 2 ** 31),
): Services {
  if (config.dataMode === "LIVE") {
    throw new Error("Live services are not built yet; set dataMode to MEMORY.");
  }
  const sessions = createMemorySessionService(store, seed);
  const preferences = createMemoryPreferencesService(store);
  return {
    health:
      config.apiUrl === undefined ? memoryHealthService : createLiveHealthService(config.apiUrl),
    admin: createMemoryAdminService(),
    games: createMemoryGameService(),
    sessions,
    preferences,
    player: createMemoryPlayerService(store),
    decisions: createMemoryDecisionService(sessions, preferences),
    stats: { list: () => Promise.resolve(readStats(store)) },
  };
}
