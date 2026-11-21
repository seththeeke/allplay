import { expect, it } from "vitest";
import type { MergeTokenDao } from "../../../src/dao/mergeToken/mergeTokenDao";
import type { MergeToken } from "../../../src/models/mergeToken";

const AT = "2026-11-21T12:00:00.000Z";
const NOW = Math.floor(Date.parse(AT) / 1000);

/** A token issued at AT by `sourcePlayerId`, expiring in 10 minutes. */
export function issued(tokenHash: string, sourcePlayerId: string): MergeToken {
  return {
    tokenHash,
    sourcePlayerId,
    sourceKind: sourcePlayerId.startsWith("GUEST#") ? "GUEST" : "ACCOUNT",
    status: "ISSUED",
    ttl: NOW + 600,
    entityVersion: 1,
    createdAt: AT,
    updatedAt: AT,
  };
}

/** Behavior every MergeTokenDao shares; `hash` makes a 64-hex key unique to the run. */
export function mergeTokenDaoContract(
  make: () => MergeTokenDao,
  hash: (name: string) => string,
  player: (name: string) => string,
): void {
  it("redeems an issued token once, and again only for the same account", async () => {
    const dao = make();
    const token = issued(hash("once"), `GUEST#${player("g")}`);
    await dao.create(token);
    const me = `ACCT#${player("a")}`;
    const redeemed = await dao.redeem(token.tokenHash, me, AT, NOW);
    expect(redeemed).toMatchObject({
      status: "REDEEMED",
      redeemedBy: me,
      sourcePlayerId: token.sourcePlayerId,
    });
    expect(await dao.redeem(token.tokenHash, me, AT, NOW + 1)).toMatchObject({ redeemedBy: me });
    expect(await dao.redeem(token.tokenHash, `ACCT#${player("other")}`, AT, NOW)).toBeNull();
  });

  it("refuses an expired or unknown token", async () => {
    const dao = make();
    const token = issued(hash("expired"), `ACCT#${player("a")}`);
    await dao.create(token);
    expect(await dao.redeem(token.tokenHash, `ACCT#${player("b")}`, AT, NOW + 600)).toBeNull();
    expect(await dao.redeem(hash("unknown"), `ACCT#${player("b")}`, AT, NOW)).toBeNull();
  });
}
