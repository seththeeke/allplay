import { expect, it } from "vitest";
import {
  PlayerExistsError,
  PlayerMissingError,
  type PlayerDao,
} from "../../../src/dao/player/playerDao";
import { guestTtl, type Player } from "../../../src/models/player";

const AT = "2026-11-21T12:00:00.000Z";

export function guest(playerId: string, at = AT): Player {
  return {
    playerId,
    kind: "GUEST",
    status: "ACTIVE",
    identityIds: [playerId.slice("GUEST#".length)],
    firstSeenAt: at,
    lastActiveAt: at,
    ttl: guestTtl(new Date(at)),
    entityVersion: 1,
    createdAt: at,
    updatedAt: at,
  };
}

export function account(playerId: string, email: string, createdAt = AT): Player {
  return {
    playerId,
    kind: "ACCOUNT",
    status: "ACTIVE",
    identityIds: ["us-east-1:identity"],
    cognitoSub: playerId.slice("ACCT#".length),
    email,
    emailKey: email.trim().toLowerCase(),
    signInProviders: ["GOOGLE"],
    firstSeenAt: createdAt,
    lastActiveAt: createdAt,
    entityVersion: 1,
    createdAt,
    updatedAt: createdAt,
  };
}

/**
 * The behavior every PlayerDao has (data-model.md section 4). `id` makes the
 * keys, so a run against a shared table never collides with another run.
 */
export function playerDaoContract(create: () => PlayerDao, id: (name: string) => string): void {
  it("counts games per window up to the limit, restarts a new window, and gives a game back", async () => {
    const dao = create();
    const playerId = `GUEST#${id("counted")}`;
    const day = { period: "DAY" as const, windowStart: "2026-11-21" };
    /* A player the table has never seen is created from the seed. */
    expect(await dao.countGame(playerId, day, 2, AT, guest(playerId))).toEqual({
      ...day,
      count: 1,
    });
    expect((await dao.get(playerId))?.kind).toBe("GUEST");
    expect(await dao.countGame(playerId, day, 2, AT, guest(playerId))).toEqual({
      ...day,
      count: 2,
    });
    expect(await dao.countGame(playerId, day, 2, AT, guest(playerId))).toBeNull();
    expect(await dao.countGame(playerId, day, 0, AT, guest(playerId))).toBeNull();
    await dao.giveBackGame(playerId, day, AT);
    expect((await dao.get(playerId))?.gamesPlayed).toEqual({ ...day, count: 1 });
    /* A give-back for another window, or none left, changes nothing. */
    await dao.giveBackGame(playerId, { ...day, windowStart: "2026-11-20" }, AT);
    expect((await dao.get(playerId))?.gamesPlayed?.count).toBe(1);
    const next = { period: "DAY" as const, windowStart: "2026-11-22" };
    expect(await dao.countGame(playerId, next, 2, AT, guest(playerId))).toEqual({
      ...next,
      count: 1,
    });
    expect(await dao.countGame(playerId, next, null, AT, guest(playerId))).toEqual({
      ...next,
      count: 2,
    });
    expect(await dao.countGame(playerId, next, null, AT, guest(playerId))).toEqual({
      ...next,
      count: 3,
    });
    await dao.giveBackGame(`GUEST#${id("never-seen")}`, next, AT);
    expect(await dao.get(`GUEST#${id("never-seen")}`)).toBeNull();
    const fresh = `GUEST#${id("zero")}`;
    await dao.create(guest(fresh));
    await dao.giveBackGame(fresh, next, AT);
    expect((await dao.get(fresh))?.gamesPlayed).toBeUndefined();
  });

  it("creates once, reads back, and refuses a second create", async () => {
    const dao = create();
    const player = guest(`GUEST#${id("create")}`);
    expect(await dao.get(player.playerId)).toBeNull();
    await dao.create(player);
    expect(await dao.get(player.playerId)).toEqual(player);
    await expect(dao.create(player)).rejects.toBeInstanceOf(PlayerExistsError);
  });

  it("updates and removes fields, stamping updatedAt, and refuses missing players", async () => {
    const dao = create();
    const player = account(`ACCT#${id("update")}`, "Pat@Example.com");
    await dao.create(player);
    const later = "2026-11-21T13:00:00.000Z";
    const updated = await dao.update(
      player.playerId,
      { displayName: "Pat", signInProviders: ["APPLE", "GOOGLE"], mergedGuestIds: [] },
      later,
    );
    expect(updated).toMatchObject({ displayName: "Pat", updatedAt: later });
    expect(updated.signInProviders).toEqual(["APPLE", "GOOGLE"]);
    expect(await dao.get(player.playerId)).toEqual(updated);
    const removed = await dao.update(player.playerId, {}, later, ["displayName"]);
    expect(removed.displayName).toBeUndefined();
    await expect(dao.update(`ACCT#${id("missing")}`, {}, later)).rejects.toBeInstanceOf(
      PlayerMissingError,
    );
  });

  it("touches lastActiveAt and a guest's ttl at most once an hour", async () => {
    const dao = create();
    const player = guest(`GUEST#${id("touch")}`);
    await dao.create(player);
    expect(await dao.touch(player.playerId, new Date("2026-11-21T12:30:00.000Z"), 1)).toBe(false);
    const hourLater = new Date("2026-11-21T13:00:00.000Z");
    expect(await dao.touch(player.playerId, hourLater, guestTtl(hourLater))).toBe(true);
    expect(await dao.get(player.playerId)).toMatchObject({
      lastActiveAt: hourLater.toISOString(),
      ttl: guestTtl(hourLater),
    });
    const accountPlayer = account(`ACCT#${id("touch-account")}`, "touch@example.com");
    await dao.create(accountPlayer);
    expect(await dao.touch(accountPlayer.playerId, hourLater)).toBe(true);
    expect((await dao.get(accountPlayer.playerId))?.ttl).toBeUndefined();
    expect(await dao.touch(`GUEST#${id("touch-missing")}`, hourLater)).toBe(false);
  });

  it("lists accounts sharing an email, oldest first, without guests", async () => {
    const dao = create();
    const email = `${id("dup")}@example.com`;
    await dao.create(
      account(`ACCT#${id("dup-new")}`, email.toUpperCase(), "2026-11-21T12:00:02.000Z"),
    );
    await dao.create(account(`ACCT#${id("dup-old")}`, email, "2026-11-21T12:00:01.000Z"));
    await dao.create(guest(`GUEST#${id("dup-guest")}`));
    /* The ByEmail index is eventually consistent in DynamoDB, so the listing is polled. */
    await expect
      .poll(async () => (await dao.listByEmail(email.toLowerCase())).map((m) => m.playerId), {
        timeout: 10_000,
        interval: 250,
      })
      .toEqual([`ACCT#${id("dup-old")}`, `ACCT#${id("dup-new")}`]);
    const matches = await dao.listByEmail(email.toLowerCase());
    expect(matches[0]).toMatchObject({ status: "ACTIVE", signInProviders: ["GOOGLE"] });
    expect(await dao.listByEmail(`${id("nobody")}@example.com`)).toEqual([]);
    await expect
      .poll(
        async () =>
          (await dao.listAllEmails())
            .filter((entry) => entry.emailKey === email.toLowerCase())
            .map((entry) => entry.playerId)
            .sort(),
        { timeout: 10_000, interval: 250 },
      )
      .toEqual([`ACCT#${id("dup-new")}`, `ACCT#${id("dup-old")}`]);
  });

  it("lists every player's counting fields for the rollup", async () => {
    const dao = create();
    const player = guest(`GUEST#${id("rollup")}`);
    await dao.create(player);
    expect(await dao.listForRollup()).toContainEqual({
      kind: "GUEST",
      status: "ACTIVE",
      lastActiveAt: player.lastActiveAt,
      createdAt: player.createdAt,
    });
  });
}
