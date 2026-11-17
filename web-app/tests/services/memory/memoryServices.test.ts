import { describe, expect, it } from "vitest";
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

describe("createServices", () => {
  it("builds memory services and refuses live mode until it exists", () => {
    expect(Object.keys(createServices({ stage: "LOCAL", dataMode: "MEMORY" }))).toEqual([
      "preferences",
      "player",
    ]);
    expect(() => createServices({ stage: "TEST", dataMode: "LIVE" })).toThrow(/Live services/);
  });
});

describe("mergeDefined", () => {
  it("applies defined values only", () => {
    expect(mergeDefined({ a: 1, b: 2 }, { a: 3, b: undefined })).toEqual({ a: 3, b: 2 });
  });
});
