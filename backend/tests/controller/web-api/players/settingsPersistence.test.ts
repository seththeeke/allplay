import { describe, expect, it, vi } from "vitest";
import { createPlayersHandler } from "../../../../src/controller/web-api/players/playersController";
import { createInMemoryGameTables } from "../../../../src/dao/gameSession/inMemoryGameSessionDao";
import { createInMemoryMergeTokenDao } from "../../../../src/dao/mergeToken/inMemoryMergeTokenDao";
import { createInMemoryPlayerDao } from "../../../../src/dao/player/inMemoryPlayerDao";
import { createDynamoPreferenceDao } from "../../../../src/dao/preference/dynamoPreferenceDao";
import { createInMemoryPreferenceDao } from "../../../../src/dao/preference/inMemoryPreferenceDao";
import { createLogger } from "../../../../src/logger";
import {
  AppPreferencesSchema,
  DEFAULT_APP_PREFERENCES,
  type AppPreferences,
} from "../../../../src/models/api";
import { createPlayerGameData } from "../../../../src/service/gameSession/playerGameData";
import { createMergeService } from "../../../../src/service/player/mergeService";
import { createPlayerService } from "../../../../src/service/player/playerService";
import { stubDynamo } from "../../../dao/dynamoStub";
import { apiEvent } from "../apiEvent";
import { CHANGED_SETTINGS } from "../../../integration/settingsFixture";

function handler() {
  const players = createInMemoryPlayerDao();
  return createPlayersHandler({
    players: createPlayerService({
      players,
      preferences: createInMemoryPreferenceDao(),
      gameData: createPlayerGameData(createInMemoryGameTables()),
    }),
    merge: createMergeService({ players, mergeTokens: createInMemoryMergeTokenDao(), steps: [] }),
    logger: createLogger({ write: vi.fn() }),
  });
}

describe("settings persistence", () => {
  it("covers every APP setting with a value other than its default", () => {
    expect(Object.keys(CHANGED_SETTINGS).sort()).toEqual(
      Object.keys(AppPreferencesSchema.shape).sort(),
    );
    for (const [field, value] of Object.entries(CHANGED_SETTINGS))
      expect(value).not.toEqual(DEFAULT_APP_PREFERENCES[field as keyof AppPreferences]);
  });

  it("saves each setting on its own and reads every one back", async () => {
    const players = handler();
    for (const [field, value] of Object.entries(CHANGED_SETTINGS)) {
      const saved = await players(
        apiEvent("PATCH /v1/players/me/preferences/{scope}", {
          identity: "g-settings",
          pathParameters: { scope: "APP" },
          body: { [field]: value },
        }),
      );
      expect(saved.statusCode).toBe(200);
    }
    const read = await players(
      apiEvent("GET /v1/players/me/preferences", { identity: "g-settings" }),
    );
    expect((JSON.parse(read.body) as { app: AppPreferences }).app).toEqual(CHANGED_SETTINGS);
  });

  it("writes every setting to the Preferences table in one update", async () => {
    const stub = stubDynamo({
      Attributes: {
        playerId: "GUEST#g",
        scope: "APP",
        ...CHANGED_SETTINGS,
        entityVersion: 1,
        createdAt: "2026-11-28T00:00:00.000Z",
        updatedAt: "2026-11-28T00:00:00.000Z",
      },
    });
    const dao = createDynamoPreferenceDao("AllPlay-Preferences-Test", stub);
    const stored = await dao.patch("GUEST#g", "APP", CHANGED_SETTINGS, "2026-11-28T00:00:00.000Z");
    expect(stored).toMatchObject(CHANGED_SETTINGS);
    const names = Object.values(
      (stub.sent[0]?.input as { ExpressionAttributeNames: Record<string, string> })
        .ExpressionAttributeNames,
    );
    for (const field of Object.keys(CHANGED_SETTINGS)) expect(names).toContain(field);
  });
});
