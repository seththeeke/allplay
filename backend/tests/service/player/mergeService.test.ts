import { describe, expect, it, vi } from "vitest";
import { createInMemoryMergeTokenDao } from "../../../src/dao/mergeToken/inMemoryMergeTokenDao";
import { createInMemoryPlayerDao } from "../../../src/dao/player/inMemoryPlayerDao";
import { createInMemoryPreferenceDao } from "../../../src/dao/preference/inMemoryPreferenceDao";
import { createMergeService, preferencesStep } from "../../../src/service/player/mergeService";
import type { PlayerCaller } from "../../../src/service/player/playerService";
import { account, guest } from "../../dao/player/playerDaoContract";

const T0 = new Date("2026-11-21T12:00:00.000Z");
const GUEST: PlayerCaller = { playerId: "GUEST#g-1", tier: "GUEST", identityId: "g-1" };
const ME: PlayerCaller = { playerId: "ACCT#a", tier: "PLAYER", identityId: "i-a" };
const OTHER: PlayerCaller = { playerId: "ACCT#b", tier: "PLAYER", identityId: "i-b" };

async function setup() {
  const players = createInMemoryPlayerDao();
  const preferences = createInMemoryPreferenceDao();
  let clock = T0;
  let n = 0;
  const after = vi.fn(() => Promise.resolve());
  const merge = createMergeService({
    players,
    mergeTokens: createInMemoryMergeTokenDao(),
    steps: [preferencesStep(preferences)],
    afterAccountMerge: after,
    now: () => clock,
    token: () => `token-${String((n += 1))}-${"x".repeat(32)}`,
  });
  await players.create(guest("GUEST#g-1"));
  await players.create(account("ACCT#a", "pat@example.com"));
  await players.create({ ...account("ACCT#b", "pat@example.com"), signInProviders: ["APPLE"] });
  return {
    players,
    preferences,
    merge,
    after,
    advance: (seconds: number) => {
      clock = new Date(clock.getTime() + seconds * 1000);
    },
  };
}

describe("merge service", () => {
  it("folds a guest into the account: missing preference scopes copied, guest marked merged", async () => {
    const { players, preferences, merge } = await setup();
    await preferences.patch("GUEST#g-1", "APP", { zoomLevel: 2 }, T0.toISOString(), 1);
    await preferences.patch(
      "GUEST#g-1",
      "GAME#spider-solitaire",
      { lastOptions: { suits: 2 } },
      T0.toISOString(),
    );
    await preferences.patch("ACCT#a", "APP", { zoomLevel: 1.5 }, T0.toISOString());
    const issued = await merge.issue(GUEST);
    expect(issued.expiresAt).toBe("2026-11-21T12:10:00.000Z");
    expect(await merge.redeem(ME, issued.token)).toEqual({
      primaryPlayerId: "ACCT#a",
      mergedPlayerId: "GUEST#g-1",
    });
    const kept = await preferences.list("ACCT#a");
    expect(kept.find((item) => item.scope === "APP")?.zoomLevel).toBe(1.5);
    const game = kept.find((item) => item.scope === "GAME#spider-solitaire");
    expect(game).toMatchObject({ lastOptions: { suits: 2 } });
    expect(game?.ttl).toBeUndefined();
    expect(await players.get("GUEST#g-1")).toMatchObject({
      status: "MERGED",
      mergedInto: "ACCT#a",
    });
    expect((await players.get("ACCT#a"))?.mergedGuestIds).toEqual(["GUEST#g-1"]);

    /* A retry by the same account gives the same result. */
    expect(await merge.redeem(ME, issued.token)).toEqual({
      primaryPlayerId: "ACCT#a",
      mergedPlayerId: "GUEST#g-1",
    });
    expect((await players.get("ACCT#a"))?.mergedGuestIds).toEqual(["GUEST#g-1"]);
    expect(await preferences.list("ACCT#a")).toHaveLength(2);
  });

  it("refuses guests, reuse by another account, expiry, self-redemption and wrong keep", async () => {
    const { merge, advance } = await setup();
    await expect(merge.redeem(GUEST, "t".repeat(40))).rejects.toThrow("Sign in");
    const first = await merge.issue(GUEST);
    await merge.redeem(ME, first.token);
    await expect(merge.redeem(OTHER, first.token)).rejects.toThrow("expired or was already used");
    const late = await merge.issue(GUEST);
    advance(600);
    await expect(merge.redeem(ME, late.token)).rejects.toThrow("expired");
    const own = await merge.issue(ME);
    await expect(merge.redeem(ME, own.token)).rejects.toThrow("different method");
    const guestKeep = await merge.issue(GUEST);
    await expect(merge.redeem(ME, guestKeep.token, "SOURCE")).rejects.toThrow(
      "keeps the signed-in account",
    );
    const noKeep = await merge.issue(ME);
    await expect(merge.redeem(OTHER, noKeep.token)).rejects.toThrow(
      "keeps the account the link came from",
    );
  });

  it("refuses a guest already merged into another account", async () => {
    const { merge } = await setup();
    await merge.redeem(OTHER, (await merge.issue(GUEST)).token);
    await expect(merge.redeem(ME, (await merge.issue(GUEST)).token)).rejects.toThrow(
      "already merged",
    );
  });

  it("merges a guest that was never recorded, and an account that is gone", async () => {
    const { merge, players } = await setup();
    const ghost: PlayerCaller = { playerId: "GUEST#ghost", tier: "GUEST", identityId: "ghost" };
    const gone: PlayerCaller = { playerId: "ACCT#gone", tier: "PLAYER", identityId: "x" };
    expect(await merge.redeem(gone, (await merge.issue(ghost)).token)).toEqual({
      primaryPlayerId: "ACCT#gone",
      mergedPlayerId: "GUEST#ghost",
    });
    expect(await players.get("ACCT#gone")).toBeNull();
  });

  it("links accounts: the caller folds into the source, gaining its providers, once", async () => {
    const { merge, players, after, preferences } = await setup();
    await preferences.patch("ACCT#b", "APP", { zoomLevel: 3 }, T0.toISOString());
    const link = await merge.issue(ME);
    expect(await merge.redeem(OTHER, link.token, "SOURCE")).toEqual({
      primaryPlayerId: "ACCT#a",
      mergedPlayerId: "ACCT#b",
    });
    const primary = await players.get("ACCT#a");
    expect(primary).toMatchObject({
      mergedAccountIds: ["ACCT#b"],
      signInProviders: ["APPLE", "GOOGLE"],
    });
    expect(await players.get("ACCT#b")).toMatchObject({ status: "MERGED", mergedInto: "ACCT#a" });
    expect((await preferences.list("ACCT#a"))[0]?.zoomLevel).toBe(3);
    expect(after).toHaveBeenCalledTimes(1);
    await merge.mergeAccounts("ACCT#a", "ACCT#b");
    expect((await players.get("ACCT#a"))?.mergedAccountIds).toEqual(["ACCT#b"]);
  });

  it("refuses account merges that are not two active accounts", async () => {
    const { merge, players } = await setup();
    await expect(merge.mergeAccounts("ACCT#a", "ACCT#a")).rejects.toThrow("two different");
    await expect(merge.mergeAccounts("ACCT#none", "ACCT#b")).rejects.toThrow("primary");
    await expect(merge.mergeAccounts("GUEST#g-1", "ACCT#b")).rejects.toThrow("primary");
    await expect(merge.mergeAccounts("ACCT#a", "GUEST#g-1")).rejects.toThrow("duplicate");
    await players.create({ ...account("ACCT#c", "c@example.com"), signInProviders: undefined });
    await merge.mergeAccounts("ACCT#b", "ACCT#c");
    await expect(merge.mergeAccounts("ACCT#a", "ACCT#c")).rejects.toThrow("duplicate");
    await expect(merge.mergeAccounts("ACCT#b", "ACCT#none")).rejects.toThrow("duplicate");
    const bare = createMergeService({
      players,
      mergeTokens: createInMemoryMergeTokenDao(),
      steps: [],
    });
    await players.create({ ...account("ACCT#d", "d@example.com"), signInProviders: undefined });
    await players.create({ ...account("ACCT#e", "e@example.com"), signInProviders: undefined });
    expect((await bare.mergeAccounts("ACCT#d", "ACCT#e")).mergedPlayerId).toBe("ACCT#e");
    expect((await bare.issue(ME)).token.length).toBeGreaterThanOrEqual(43);
  });
});
