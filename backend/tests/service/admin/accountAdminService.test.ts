import { describe, expect, it, vi } from "vitest";
import { createDeployedAccountAdminService } from "../../../src/service/admin/accountAdminService";
import {
  cognitoAccountMerge,
  createDeployedMergeService,
} from "../../../src/service/player/mergeService";
import type { IdentityService } from "../../../src/service/player/identityService";
import { account } from "../../dao/player/playerDaoContract";

describe("deployed account administration", () => {
  it("builds over the stage tables without calling AWS", () => {
    vi.stubEnv("AWS_REGION", "us-east-1");
    expect(typeof createDeployedAccountAdminService({}).duplicates).toBe("function");
    expect(typeof createDeployedMergeService({ USER_POOL_ID: "pool" }).mergeAccounts).toBe(
      "function",
    );
    vi.unstubAllEnvs();
  });

  it("merges the Cognito users by sub, falling back to the player id", async () => {
    const mergeUsers = vi.fn<IdentityService["mergeUsers"]>(() => Promise.resolve([]));
    const hook = cognitoAccountMerge({ mergeUsers } as unknown as IdentityService, "pool");
    await hook(account("ACCT#a", "a@x.y"), {
      ...account("ACCT#b", "b@x.y"),
      cognitoSub: undefined,
    });
    expect(mergeUsers).toHaveBeenCalledWith("pool", "a", "b");
  });
});
