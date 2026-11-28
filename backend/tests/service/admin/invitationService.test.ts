import { describe, expect, it } from "vitest";
import {
  createDeployedInvitationService,
  createInMemoryInvitationService,
  createInvitationService,
} from "../../../src/service/admin/invitationService";

describe("invitation service", () => {
  it("invites through the identity service in the stage's pool", async () => {
    const pools: string[] = [];
    const service = createInvitationService(
      {
        invite: (pool, email) => {
          pools.push(pool);
          return Promise.resolve(email === "new@example.com");
        },
      },
      "us-east-1_pool",
    );
    expect(await service.invite("new@example.com")).toBe("INVITED");
    expect(await service.invite("old@example.com")).toBe("ALREADY_INVITED");
    expect(pools).toEqual(["us-east-1_pool", "us-east-1_pool"]);
  });

  it("keeps local invitations in memory, one per email", async () => {
    const local = createInMemoryInvitationService();
    expect(await local.invite("Pat@example.com")).toBe("INVITED");
    expect(await local.invite("pat@example.com ")).toBe("ALREADY_INVITED");
    expect([...local.invited]).toEqual(["pat@example.com"]);
  });

  it("builds the deployed service", () => {
    expect(createDeployedInvitationService({ USER_POOL_ID: "p" })).toHaveProperty("invite");
    expect(createDeployedInvitationService({})).toHaveProperty("invite");
  });
});
