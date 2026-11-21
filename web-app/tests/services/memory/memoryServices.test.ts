import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_PREFERENCES } from "../../../src/models/api";
import { createServices } from "../../../src/services/createServices";
import { mergeDefined } from "../../../src/services/mergeDefined";
import { createMemoryPlayerService } from "../../../src/services/memory/memoryPlayerService";
import { createMemoryPreferencesService } from "../../../src/services/memory/memoryPreferencesService";
import { createMemoryStore } from "../../../src/services/memory/memoryStore";

describe("memory preferences service", () => {
  it("starts from defaults and saves application patches", async () => {
    const service = createMemoryPreferencesService(createMemoryStore(null));
    expect((await service.get()).app).toEqual(DEFAULT_APP_PREFERENCES);
    const saved = await service.patchApp({ theme: "DARK", zoomLevel: 2 });
    expect(saved.app).toMatchObject({ theme: "DARK", zoomLevel: 2, voiceId: "Joanna" });
    expect((await service.get()).app.theme).toBe("DARK");
  });

  it("creates and updates per-game preferences", async () => {
    const service = createMemoryPreferencesService(createMemoryStore(null));
    await service.patchGame("spider-solitaire", { helpSeen: true });
    const saved = await service.patchGame("spider-solitaire", { overrides: { zoomLevel: 1.5 } });
    expect(saved.games["spider-solitaire"]).toEqual({
      helpSeen: true,
      lastOptions: null,
      overrides: { zoomLevel: 1.5 },
    });
  });

  it("rejects invalid values and ignores invalid stored data", async () => {
    const store = createMemoryStore(null);
    const service = createMemoryPreferencesService(store);
    await expect(service.patchApp({ zoomLevel: 9 })).rejects.toThrow();
    store.write("allplay.memory.preferences", { app: { theme: "PINK" } });
    expect((await service.get()).app).toEqual(DEFAULT_APP_PREFERENCES);
  });
});

describe("memory player service", () => {
  it("starts as a guest, signs in players and admins, and signs out", async () => {
    const service = createMemoryPlayerService(createMemoryStore(null));
    expect((await service.me()).tier).toBe("GUEST");
    expect(await service.signIn(" Pat@Example.com ")).toEqual({
      playerId: "ACCT#pat@example.com",
      kind: "ACCOUNT",
      tier: "PLAYER",
      displayName: "pat",
      email: "pat@example.com",
    });
    expect((await service.signIn("admin@example.com")).tier).toBe("ADMIN");
    expect((await service.me()).tier).toBe("ADMIN");
    expect((await service.signOut()).kind).toBe("GUEST");
  });
});

const SERVICE_NAMES = [
  "admin",
  "decisions",
  "games",
  "health",
  "player",
  "preferences",
  "sessions",
  "speechInput",
  "speechOutput",
  "stats",
  "voiceLab",
];

describe("createServices", () => {
  it("builds memory services, and live game services only with an API URL", async () => {
    const memory = createServices({ stage: "LOCAL", dataMode: "MEMORY" });
    expect(Object.keys(memory).sort()).toEqual(SERVICE_NAMES);
    expect(memory.speechInput.kind).toBe("TYPED");
    expect(() => createServices({ stage: "TEST", dataMode: "LIVE" })).toThrow(/needs an apiUrl/);
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ games: [] }))));
    vi.stubGlobal("fetch", fetchSpy);
    const live = createServices({
      stage: "LOCAL",
      dataMode: "LIVE",
      apiUrl: "http://localhost:4000/",
      speechInput: "LOCAL_SERVER",
    });
    expect(live.speechInput.kind).toBe("LOCAL_SERVER");
    await expect(live.games.list()).resolves.toEqual({ games: [] });
    expect(fetchSpy).toHaveBeenCalledWith("http://localhost:4000/v1/games", {
      headers: { "x-allplay-dev-caller": "guest:local-guest" },
    });
    const deployed = createServices({
      stage: "TEST",
      dataMode: "LIVE",
      apiUrl: "https://api.example.com/",
    });
    await deployed.games.list();
    expect(fetchSpy).toHaveBeenLastCalledWith("https://api.example.com/v1/games", { headers: {} });
    vi.unstubAllGlobals();
  });

  it("uses Test's Cognito locally when config.local.json asks for it", () => {
    const local = createServices({
      stage: "LOCAL",
      dataMode: "LIVE",
      apiUrl: "http://localhost:4000/",
      region: "us-east-1",
      userPoolId: "us-east-1_pool",
      userPoolClientId: "client",
      identityPoolId: "us-east-1:pool",
      oauthDomain: "allplay-test-x.auth.us-east-1.amazoncognito.com",
      localAuth: "COGNITO_TEST",
    });
    expect(local.player.providers).toEqual([]);
    const mock = createServices({
      stage: "LOCAL",
      dataMode: "LIVE",
      apiUrl: "http://localhost:4000/",
    });
    expect(mock.player.providers).toEqual(["GOOGLE", "APPLE"]);
  });

  it("checks health live when the stage config has an API URL", async () => {
    const local = createServices({ stage: "LOCAL", dataMode: "MEMORY" });
    await expect(local.health.check()).resolves.toMatchObject({ body: { stage: "LOCAL" } });
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ status: "OK", stage: "Test" }))),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const staged = createServices({
      stage: "TEST",
      dataMode: "MEMORY",
      apiUrl: "https://api.example.com/",
    });
    await expect(staged.health.check()).resolves.toMatchObject({ body: { stage: "Test" } });
    vi.unstubAllGlobals();
  });
});

describe("mergeDefined", () => {
  it("applies defined values only", () => {
    expect(mergeDefined({ a: 1, b: 2 }, { a: 3, b: undefined })).toEqual({ a: 3, b: 2 });
  });
});
