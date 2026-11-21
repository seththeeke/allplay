import { describe, expect, it } from "vitest";
import { createInMemoryPlayerDao } from "../../../src/dao/player/inMemoryPlayerDao";
import type { PlayerDao } from "../../../src/dao/player/playerDao";
import type { PoolUser, UserPoolDirectory } from "../../../src/dao/userPool/userPoolDirectory";
import {
  createAccountService,
  createDeployedAccountService,
  providerOf,
} from "../../../src/service/player/accountService";
import { createIdentityService } from "../../../src/service/player/identityService";

let clock = Date.parse("2026-11-21T12:00:00.000Z");
const now = () => new Date(clock);

function fakeDirectory(users: PoolUser[] = []) {
  const calls: string[] = [];
  const directory: UserPoolDirectory = {
    usersByEmail: () => Promise.resolve(users),
    linkProvider: (_pool, dest, provider) => {
      calls.push(`link ${dest} ${provider}`);
      return Promise.resolve();
    },
    addToGroup: (_pool, username, group) => {
      calls.push(`group ${username} ${group}`);
      return Promise.resolve();
    },
  };
  return { directory, calls };
}

const poolUser = (
  username: string,
  emailVerified: boolean,
  providers: string[] = [],
): PoolUser => ({
  username,
  emailVerified,
  providers,
  createdAt: 0,
});

describe("identity service", () => {
  it("prefers a verified user that lacks the incoming provider", async () => {
    const { directory, calls } = fakeDirectory([
      poolUser("self", true),
      poolUser("has-google", true, ["Google"]),
      poolUser("unverified", false),
      poolUser("verified", true),
    ]);
    const identities = createIdentityService(directory);
    expect(await identities.linkTarget("p", "e", "self", "Google")).toBe("verified");
    expect(await identities.emailInUse("p", "e")).toBe(true);
    await identities.link("p", "verified", "Google", "g1");
    await identities.addToGroup("p", "verified", "PLAYER");
    expect(calls).toEqual(["link verified Google", "group verified PLAYER"]);
    const unverifiedOnly = createIdentityService(fakeDirectory([poolUser("u", false)]).directory);
    expect(await unverifiedOnly.linkTarget("p", "e", "self", "Google")).toBe("u");
    const empty = createIdentityService(fakeDirectory().directory);
    expect(await empty.linkTarget("p", "e", "self", "Google")).toBeNull();
    expect(await empty.emailInUse("p", "e")).toBe(false);
    expect(typeof createIdentityService().link).toBe("function");
  });
});

describe("account service", () => {
  const signIn = { sub: "sub-1", email: "Pat@Example.com", provider: "GOOGLE" as const };

  it("creates the account once, with the normalized email key and relay flag", async () => {
    const players = createInMemoryPlayerDao();
    const accounts = createAccountService({ players, now });
    const created = await accounts.ensureAccount({ ...signIn, displayName: "Pat" });
    expect(created).toMatchObject({
      playerId: "ACCT#sub-1",
      kind: "ACCOUNT",
      emailKey: "pat@example.com",
      displayName: "Pat",
      signInProviders: ["GOOGLE"],
    });
    expect(created.ttl).toBeUndefined();
    expect(await accounts.ensureAccount(signIn)).toEqual(created);
    const relay = await accounts.ensureAccount({
      sub: "sub-r",
      email: "x@privaterelay.appleid.com",
      provider: "APPLE",
    });
    expect(relay.relayEmailEnabled).toBe(true);
  });

  it("records sign-ins, adds new providers, and reports active duplicates", async () => {
    const players = createInMemoryPlayerDao();
    const accounts = createAccountService({ players, now });
    await accounts.ensureAccount({ sub: "older", email: "pat@example.com", provider: "COGNITO" });
    clock += 2 * 60 * 60 * 1000;
    const { duplicates } = await accounts.recordSignIn(signIn);
    expect(duplicates).toEqual(["ACCT#older"]);
    clock += 2 * 60 * 60 * 1000;
    await accounts.recordSignIn({ ...signIn, provider: "APPLE" });
    expect((await players.get("ACCT#sub-1"))?.signInProviders).toEqual(["APPLE", "GOOGLE"]);
    await players.update("ACCT#older", { status: "MERGED" }, now().toISOString());
    expect((await accounts.recordSignIn(signIn)).duplicates).toEqual([]);
  });

  it("returns the stored account when a concurrent trigger created it first", async () => {
    const real = createInMemoryPlayerDao();
    let first = true;
    const racing: PlayerDao = {
      ...real,
      get: async (id) => {
        if (first) {
          first = false;
          await real.create({
            playerId: id,
            kind: "ACCOUNT",
            status: "ACTIVE",
            identityIds: [],
            firstSeenAt: "2026-11-21T00:00:00.000Z",
            lastActiveAt: "2026-11-21T00:00:00.000Z",
            entityVersion: 1,
            createdAt: "2026-11-21T00:00:00.000Z",
            updatedAt: "2026-11-21T00:00:00.000Z",
          });
          return null;
        }
        return real.get(id);
      },
    };
    const player = await createAccountService({ players: racing, now }).ensureAccount(signIn);
    expect(player.createdAt).toBe("2026-11-21T00:00:00.000Z");
    const failing: PlayerDao = {
      ...real,
      get: () => Promise.resolve(null),
      create: () => Promise.reject(new Error("down")),
    };
    await expect(createAccountService({ players: failing }).ensureAccount(signIn)).rejects.toThrow(
      "down",
    );
    const vanished: PlayerDao = {
      ...real,
      get: () => Promise.resolve(null),
      create: async (p) => {
        await Promise.resolve();
        throw new (await import("../../../src/dao/player/playerDao")).PlayerExistsError(p.playerId);
      },
    };
    expect(
      (await createAccountService({ players: vanished, now }).ensureAccount(signIn)).playerId,
    ).toBe("ACCT#sub-1");
  });

  it("maps provider names and builds the deployed service", () => {
    expect(providerOf("Google")).toBe("GOOGLE");
    expect(providerOf("SignInWithApple")).toBe("APPLE");
    expect(providerOf("Facebook")).toBe("COGNITO");
    expect(providerOf(undefined)).toBe("COGNITO");
    expect(typeof createDeployedAccountService({ PLAYERS_TABLE: "t" }).recordSignIn).toBe(
      "function",
    );
    expect(typeof createDeployedAccountService({}).recordSignIn).toBe("function");
  });
});
