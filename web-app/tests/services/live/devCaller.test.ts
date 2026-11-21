import { describe, expect, it } from "vitest";
import { devCallerFor } from "../../../src/services/live/devCaller";

describe("development caller", () => {
  it("maps the mock-signed-in player to the local server's caller header", () => {
    expect(devCallerFor(null)).toBe("guest:local-guest");
    expect(
      devCallerFor({
        playerId: "GUEST#x",
        kind: "GUEST",
        tier: "GUEST",
        displayName: null,
        email: null,
      }),
    ).toBe("guest:local-guest");
    expect(
      devCallerFor({
        playerId: "ACCT#pat@example.com",
        kind: "ACCOUNT",
        tier: "PLAYER",
        displayName: "pat",
        email: "Pat@Example.com",
      }),
    ).toBe("player:pat-example-com");
    expect(
      devCallerFor({
        playerId: "ACCT#admin@example.com",
        kind: "ACCOUNT",
        tier: "ADMIN",
        displayName: "admin",
        email: null,
      }),
    ).toBe("admin:acct-admin-example-com");
  });
});
