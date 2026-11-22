import { PreferencesResponseSchema } from "../../models/api";
import type { PreferencesService } from "../types";
import type { ApiClient } from "./apiClient";

/** The preference routes through an API client: the local server in local LIVE mode (WP-1). */
export function createLivePreferencesService(api: ApiClient): PreferencesService {
  const scoped = (scope: string, body: object) =>
    api.patch(
      `v1/players/me/preferences/${encodeURIComponent(scope)}`,
      body,
      PreferencesResponseSchema,
    );
  return {
    get: () => api.get("v1/players/me/preferences", PreferencesResponseSchema),
    patchApp: (changes) => scoped("APP", changes),
    patchGame: (gameId, changes) => scoped(`GAME#${gameId}`, changes),
  };
}
