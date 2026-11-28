import { describe, expect, it } from "vitest";
import { createInMemoryPlayerDao } from "../../../src/dao/player/inMemoryPlayerDao";
import {
  createDeployedGameLimitAdminService,
  createGameLimitAdminService,
} from "../../../src/service/admin/gameLimitAdminService";
import { createGameAllowanceService } from "../../../src/service/player/gameAllowance";
import { account } from "../../dao/player/playerDaoContract";

const AT = new Date("2026-11-21T12:00:00.000Z");

async function setup() {
  const players = createInMemoryPlayerDao();
  await players.create(account("ACCT#old", "Pat@example.com", "2026-01-01T00:00:00.000Z"));
  await players.create({
    ...account("ACCT#gone", "pat@example.com", "2026-02-01T00:00:00.000Z"),
    status: "DELETED",
  });
  const allowance = createGameAllowanceService({
    players,
    defaultLimit: { count: 5, period: "DAY" },
    now: () => AT,
  });
  return { players, admin: createGameLimitAdminService(players, allowance, () => AT) };
}

describe("game limit admin service", () => {
  it("finds active accounts by email with their limit and use", async () => {
    const { admin } = await setup();
    expect(await admin.find(" PAT@example.com ")).toEqual([
      {
        playerId: "ACCT#old",
        email: "Pat@example.com",
        gameLimit: null,
        gameAllowance: { limit: 5, period: "DAY", used: 0, resetsAt: "2026-11-22T00:00:00.000Z" },
      },
    ]);
    expect(await admin.find("nobody@example.com")).toEqual([]);
  });

  it("sets a limit, makes a player unlimited, clears back to the default, and refuses a stranger", async () => {
    const { admin, players } = await setup();
    expect(
      (await admin.setLimit("ACCT#old", { count: 10, period: "WEEK" })).gameAllowance,
    ).toMatchObject({ limit: 10, period: "WEEK" });
    expect((await admin.setLimit("ACCT#old", { unlimited: true })).gameAllowance.limit).toBeNull();
    const cleared = await admin.setLimit("ACCT#old", null);
    expect(cleared.gameLimit).toBeNull();
    expect((await players.get("ACCT#old"))?.gameLimit).toBeUndefined();
    await expect(admin.setLimit("ACCT#nobody", null)).rejects.toMatchObject({ status: 404 });
  });

  it("builds the deployed service", () => {
    expect(createDeployedGameLimitAdminService({ PLAYERS_TABLE: "t" })).toHaveProperty("find");
    expect(createDeployedGameLimitAdminService({})).toHaveProperty("setLimit");
  });
});
