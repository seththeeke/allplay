import { expect, it } from "vitest";
import type { PreferenceDao } from "../../../src/dao/preference/preferenceDao";

/** The behavior every PreferenceDao has (data-model.md section 5). */
export function preferenceDaoContract(
  create: () => PreferenceDao,
  id: (name: string) => string,
): void {
  it("creates a scope on first write and merges later writes field by field", async () => {
    const dao = create();
    const playerId = `GUEST#${id("prefs")}`;
    expect(await dao.list(playerId)).toEqual([]);
    const first = await dao.patch(
      playerId,
      "APP",
      { zoomLevel: 2, theme: "DARK" },
      "2026-11-21T12:00:00.000Z",
      1,
    );
    expect(first).toMatchObject({
      playerId,
      scope: "APP",
      zoomLevel: 2,
      theme: "DARK",
      ttl: 1,
      entityVersion: 1,
      createdAt: "2026-11-21T12:00:00.000Z",
    });
    const second = await dao.patch(
      playerId,
      "APP",
      { theme: "HIGH_CONTRAST" },
      "2026-11-21T12:05:00.000Z",
      2,
    );
    expect(second).toMatchObject({
      zoomLevel: 2,
      theme: "HIGH_CONTRAST",
      ttl: 2,
      createdAt: "2026-11-21T12:00:00.000Z",
      updatedAt: "2026-11-21T12:05:00.000Z",
    });
    await dao.patch(
      playerId,
      "GAME#spider-solitaire",
      { helpSeen: true, lastOptions: { suits: 2 }, overrides: { zoomLevel: 3 } },
      "2026-11-21T12:06:00.000Z",
    );
    const listed = await dao.list(playerId);
    expect(listed.map((item) => item.scope).sort()).toEqual(["APP", "GAME#spider-solitaire"]);
    const game = listed.find((item) => item.scope !== "APP");
    expect(game).toMatchObject({
      helpSeen: true,
      lastOptions: { suits: 2 },
      overrides: { zoomLevel: 3 },
    });
    expect(game?.ttl).toBeUndefined();
    expect(await dao.list(`GUEST#${id("other")}`)).toEqual([]);
  });

  it("refuses values outside the preference schema", async () => {
    const dao = create();
    await expect(
      dao.patch(`GUEST#${id("bad")}`, "APP", { zoomLevel: 9 }, "2026-11-21T12:00:00.000Z"),
    ).rejects.toThrow();
  });
}
