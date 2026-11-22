import type { MergeToken } from "../../models/mergeToken";

/**
 * Merge token persistence (data-model.md section 9). The in-memory and
 * DynamoDB implementations share one contract test.
 */
export interface MergeTokenDao {
  create(token: MergeToken): Promise<void>;
  /**
   * Marks the token redeemed by `redeemedBy` when it is issued and unexpired
   * at `nowSeconds`. A token this caller already redeemed is returned again,
   * so a merge interrupted after redemption can be retried. Null otherwise.
   */
  redeem(
    tokenHash: string,
    redeemedBy: string,
    at: string,
    nowSeconds: number,
  ): Promise<MergeToken | null>;
}
