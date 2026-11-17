import type { AppConfig } from "../config";
import { createMemoryGameService } from "./memory/memoryGameService";
import { createMemoryPlayerService } from "./memory/memoryPlayerService";
import { createMemoryPreferencesService } from "./memory/memoryPreferencesService";
import { createMemoryStore, type MemoryStore } from "./memory/memoryStore";
import type { Services } from "./types";

/** Builds every service for the configured data mode. Live services arrive in phase 7 (WP-1). */
export function createServices(
  config: AppConfig,
  store: MemoryStore = createMemoryStore(),
): Services {
  if (config.dataMode === "LIVE") {
    throw new Error("Live services are not built yet; set dataMode to MEMORY.");
  }
  return {
    games: createMemoryGameService(),
    preferences: createMemoryPreferencesService(store),
    player: createMemoryPlayerService(store),
  };
}
