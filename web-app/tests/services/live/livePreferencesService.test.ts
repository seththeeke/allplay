import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_PREFERENCES } from "../../../src/models/api";
import { createApiClient } from "../../../src/services/live/apiClient";
import { createLivePreferencesService } from "../../../src/services/live/livePreferencesService";

describe("live preferences service", () => {
  it("reads and patches the caller's preferences through the API", async () => {
    const body = { app: DEFAULT_APP_PREFERENCES, games: {} };
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(JSON.stringify(body))),
    );
    const preferences = createLivePreferencesService(
      createApiClient("http://localhost:4000", fetchImpl),
    );
    expect(await preferences.get()).toEqual(body);
    await preferences.patchApp({ zoomLevel: 2 });
    await preferences.patchGame("spider-solitaire", { lastOptions: { suits: 1 } });
    expect(fetchImpl.mock.calls.map((call) => [call[0], call[1]?.method])).toEqual([
      ["http://localhost:4000/v1/players/me/preferences", undefined],
      ["http://localhost:4000/v1/players/me/preferences/APP", "PATCH"],
      ["http://localhost:4000/v1/players/me/preferences/GAME%23spider-solitaire", "PATCH"],
    ]);
    expect((fetchImpl.mock.calls[1]?.[1] as RequestInit).body).toBe(
      JSON.stringify({ zoomLevel: 2 }),
    );
  });
});
