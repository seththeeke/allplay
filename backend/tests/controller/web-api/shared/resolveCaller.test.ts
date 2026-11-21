import { describe, expect, it } from "vitest";
import { HttpEventSchema } from "../../../../src/controller/web-api/shared/httpEvent";
import {
  resolveCaller,
  tierAtLeast,
} from "../../../../src/controller/web-api/shared/resolveCaller";
import { devIdentity, devPlayerId } from "../../../../src/local/eventAdapter";

/** A recorded-style request context with the given IAM fields. */
const event = (iam: unknown) =>
  HttpEventSchema.parse({
    rawPath: "/v1/games",
    requestContext: {
      requestId: "r",
      http: { method: "GET", path: "/v1/games" },
      authorizer: { iam },
    },
  });

const POOL = "us-east-1:pool-1";
const deployedGuest = {
  cognitoIdentity: {
    identityId: "us-east-1:guest-1",
    identityPoolId: POOL,
    amr: ["unauthenticated"],
  },
  userArn:
    "arn:aws:sts::123456789012:assumed-role/AllPlay-GuestRole-Test/CognitoIdentityCredentials",
};
const deployedAccount = (role: string) => ({
  cognitoIdentity: {
    identityId: "us-east-1:acct-1",
    identityPoolId: POOL,
    amr: [
      "authenticated",
      "cognito-idp.us-east-1.amazonaws.com/us-east-1_abc",
      "cognito-idp.us-east-1.amazonaws.com/us-east-1_abc:CognitoSignIn:7b3e9a10-sub",
    ],
  },
  userArn: `arn:aws:sts::123456789012:assumed-role/${role}/CognitoIdentityCredentials`,
});

describe("resolveCaller", () => {
  it("resolves guests and accounts with the tier of their role", () => {
    expect(resolveCaller(event(deployedGuest), POOL)).toEqual({
      playerId: "GUEST#us-east-1:guest-1",
      tier: "GUEST",
      identityId: "us-east-1:guest-1",
    });
    for (const [role, tier] of [
      ["AllPlay-PlayerRole-Test", "PLAYER"],
      ["AllPlay-PlayerPlusRole-Test", "PLAYER_PLUS"],
      ["AllPlay-AdminRole-Test", "ADMIN"],
      ["SomethingElse", "PLAYER"],
    ] as const) {
      expect(resolveCaller(event(deployedAccount(role)), POOL)).toEqual({
        playerId: "ACCT#7b3e9a10-sub",
        tier,
        identityId: "us-east-1:acct-1",
      });
    }
    expect(resolveCaller(event({ ...deployedAccount("x"), userArn: undefined }))?.tier).toBe(
      "PLAYER",
    );
  });

  it("refuses other pools, missing identities and authenticated identities without a sub", () => {
    expect(resolveCaller(event(deployedGuest), "us-east-1:other-pool")).toBeNull();
    expect(resolveCaller(event({}))).toBeNull();
    expect(resolveCaller(event({ cognitoIdentity: null }))).toBeNull();
    expect(
      resolveCaller(event({ cognitoIdentity: { identityId: "x", amr: ["authenticated"] } })),
    ).toBeNull();
    expect(resolveCaller(event({ cognitoIdentity: { identityId: "x" } }))).toEqual({
      playerId: "GUEST#x",
      tier: "GUEST",
      identityId: "x",
    });
  });

  it("resolves the local development callers to the same players the local server lists", () => {
    for (const caller of [
      { tier: "guest", id: "local-guest" },
      { tier: "player", id: "pat" },
      { tier: "admin", id: "root" },
    ] as const) {
      const resolved = resolveCaller(event(devIdentity(caller)), "local");
      expect(resolved?.playerId).toBe(devPlayerId(caller));
      expect(resolved?.tier).toBe(
        { guest: "GUEST", player: "PLAYER", admin: "ADMIN" }[caller.tier],
      );
    }
  });

  it("orders tiers", () => {
    expect(tierAtLeast("ADMIN", "PLAYER")).toBe(true);
    expect(tierAtLeast("PLAYER", "PLAYER")).toBe(true);
    expect(tierAtLeast("GUEST", "PLAYER")).toBe(false);
    expect(tierAtLeast("PLAYER_PLUS", "ADMIN")).toBe(false);
  });
});
