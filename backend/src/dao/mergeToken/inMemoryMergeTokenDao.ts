import { MergeTokenSchema, type MergeToken } from "../../models/mergeToken";
import type { MergeTokenDao } from "./mergeTokenDao";

/** MergeTokenDao over a map; reads return copies. */
export function createInMemoryMergeTokenDao(): MergeTokenDao {
  const items = new Map<string, MergeToken>();
  return {
    create: (token) => {
      items.set(token.tokenHash, structuredClone(MergeTokenSchema.parse(token)));
      return Promise.resolve();
    },
    redeem: (tokenHash, redeemedBy, at, nowSeconds) => {
      const token = items.get(tokenHash);
      const usable =
        token !== undefined &&
        token.ttl > nowSeconds &&
        (token.status === "ISSUED" || token.redeemedBy === redeemedBy);
      if (!usable) return Promise.resolve(null);
      const next: MergeToken = { ...token, status: "REDEEMED", redeemedBy, updatedAt: at };
      items.set(tokenHash, next);
      return Promise.resolve(structuredClone(next));
    },
  };
}
