import { describe, expect, it, vi } from "vitest";
import type { AppleClient, AppleEvent } from "../../../src/dao/apple/appleClient";
import { createInMemoryPlayerDao } from "../../../src/dao/player/inMemoryPlayerDao";
import { createLogger } from "../../../src/logger";
import {
  createAppleService,
  createDeployedAppleService,
} from "../../../src/service/player/appleService";
import type { IdentityService } from "../../../src/service/player/identityService";
import type { PlayerService } from "../../../src/service/player/playerService";

const CREDENTIALS = { servicesId: "s", teamId: "t", keyId: "k", privateKeyPem: "p" };
const write = vi.fn();

function setup(
  event: AppleEvent,
  options: { credentials?: boolean; playerId?: string | null } = {},
) {
  const players = createInMemoryPlayerDao();
  const revokeWithCode = vi.fn<AppleClient["revokeWithCode"]>(() => Promise.resolve());
  const apple: AppleClient = {
    revokeWithCode,
    verifyNotification: vi.fn(() => Promise.resolve(event)),
  };
  const identities = {
    playerIdForApple: () =>
      Promise.resolve(options.playerId === undefined ? "ACCT#sub-1" : options.playerId),
  } as unknown as IdentityService;
  const deleteAccount = vi.fn<PlayerService["deleteAccount"]>(() => Promise.resolve());
  const accounts = { deleteAccount } as unknown as PlayerService;
  const service = createAppleService({
    credentials: () => Promise.resolve(options.credentials === false ? null : CREDENTIALS),
    apple,
    identities,
    userPoolId: "pool",
    players,
    accounts,
    logger: createLogger({ write }),
    now: () => new Date("2026-11-21T12:00:00.000Z"),
  });
  return { service, players, revokeWithCode, deleteAccount };
}

describe("Apple service", () => {
  it("revokes with a fresh code, and skips or survives every failure", async () => {
    const t = setup({ type: "consent-revoked", sub: "a" });
    expect(await t.service.revokeForDeletion("code")).toBe(true);
    expect(t.revokeWithCode).toHaveBeenCalledWith(CREDENTIALS, "code");
    expect(await t.service.revokeForDeletion(undefined)).toBe(false);
    expect(await t.service.revokeForDeletion("")).toBe(false);
    expect(
      await setup(
        { type: "consent-revoked", sub: "a" },
        { credentials: false },
      ).service.revokeForDeletion("c"),
    ).toBe(false);
    t.revokeWithCode.mockRejectedValueOnce(new Error("invalid_grant"));
    expect(await t.service.revokeForDeletion("old")).toBe(false);
  });

  it("deletes the account when consent is revoked or the Apple Account is deleted", async () => {
    for (const type of ["consent-revoked", "account-delete", "account-deleted"] as const) {
      const t = setup({ type, sub: "a" });
      expect(await t.service.handleNotification("jwt")).toBe("ACCOUNT_DELETED");
      expect(t.deleteAccount).toHaveBeenCalledWith({
        playerId: "ACCT#sub-1",
        tier: "PLAYER",
        identityId: "",
      });
    }
  });

  it("records the relay email setting, ignores unknown users, and refuses without Apple configured", async () => {
    const disabled = setup({ type: "email-disabled", sub: "a" });
    await disabled.players.create({
      playerId: "ACCT#sub-1",
      kind: "ACCOUNT",
      status: "ACTIVE",
      identityIds: [],
      firstSeenAt: "2026-11-21T00:00:00.000Z",
      lastActiveAt: "2026-11-21T00:00:00.000Z",
      entityVersion: 1,
      createdAt: "2026-11-21T00:00:00.000Z",
      updatedAt: "2026-11-21T00:00:00.000Z",
    });
    expect(await disabled.service.handleNotification("jwt")).toBe("RELAY_DISABLED");
    expect((await disabled.players.get("ACCT#sub-1"))?.relayEmailEnabled).toBe(false);
    const enabled = setup({ type: "email-enabled", sub: "a" });
    const stored = await disabled.players.get("ACCT#sub-1");
    if (stored === null) throw new Error("missing player");
    await enabled.players.create(stored);
    expect(await enabled.service.handleNotification("jwt")).toBe("RELAY_ENABLED");
    expect(
      await setup(
        { type: "consent-revoked", sub: "a" },
        { playerId: null },
      ).service.handleNotification("jwt"),
    ).toBe("NO_ACCOUNT");
    await expect(
      setup(
        { type: "consent-revoked", sub: "a" },
        { credentials: false },
      ).service.handleNotification("jwt"),
    ).rejects.toThrow("not configured");
    expect(
      typeof createDeployedAppleService({
        identities: {} as IdentityService,
        players: createInMemoryPlayerDao(),
        accounts: {} as PlayerService,
        logger: createLogger({ write }),
      }).handleNotification,
    ).toBe("function");
  });
});
