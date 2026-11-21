import { describe, expect, it, vi } from "vitest";
import type { PlayerMe } from "../../../src/models/api";
import { ApiRequestError } from "../../../src/services/errors";
import {
  MERGE_TOKEN_KEY,
  withGuestMerge,
  type MergeApi,
} from "../../../src/services/live/guestMerge";
import type { PlayerService } from "../../../src/services/types";

const GUEST: PlayerMe = {
  playerId: "GUEST#g",
  kind: "GUEST",
  tier: "GUEST",
  displayName: null,
  email: null,
};
const ACCOUNT: PlayerMe = {
  playerId: "ACCT#a",
  kind: "ACCOUNT",
  tier: "PLAYER",
  displayName: null,
  email: "a@x.y",
};
const NOW = new Date("2026-11-21T12:00:00.000Z");
const LATER = "2026-11-21T12:10:00.000Z";

function setup(start: PlayerMe = GUEST) {
  let current = start;
  const inner: PlayerService = {
    providers: [],
    me: vi.fn(() => Promise.resolve(current)),
    signIn: vi.fn(() => {
      current = ACCOUNT;
      return Promise.resolve(current);
    }),
    signInWithProvider: vi.fn(() => Promise.resolve(ACCOUNT)),
    signUp: vi.fn(() => Promise.resolve()),
    confirmSignUp: vi.fn(() => {
      current = ACCOUNT;
      return Promise.resolve(current);
    }),
    requestPasswordReset: vi.fn(() => Promise.resolve()),
    confirmPasswordReset: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve(GUEST)),
    startLink: vi.fn(() => {
      current = GUEST;
      return Promise.resolve(GUEST);
    }),
    deleteAccount: vi.fn(() => Promise.resolve(GUEST)),
  };
  const api = {
    issue: vi.fn<MergeApi["issue"]>(() =>
      Promise.resolve({ token: "t".repeat(43), expiresAt: LATER }),
    ),
    redeem: vi.fn<MergeApi["redeem"]>(() =>
      Promise.resolve({ primaryPlayerId: "ACCT#a", mergedPlayerId: "GUEST#g" }),
    ),
  };
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };
  const player = withGuestMerge(inner, api, storage, () => NOW);
  return { player, api, store, inner };
}

describe("guest merge", () => {
  it("issues a token before a guest signs in and redeems it once signed in", async () => {
    const { player, api, store } = setup();
    expect(await player.signIn("a@x.y", "pw")).toEqual(ACCOUNT);
    expect(api.issue).toHaveBeenCalledTimes(1);
    expect(api.redeem).toHaveBeenCalledWith("t".repeat(43));
    expect(store.has(MERGE_TOKEN_KEY)).toBe(false);
  });

  it("carries the token across sign-up, confirmation and a provider redirect", async () => {
    const { player, api, store } = setup();
    await player.signUp("a@x.y", "pw");
    expect(store.has(MERGE_TOKEN_KEY)).toBe(true);
    await player.confirmSignUp("a@x.y", "123456");
    expect(api.redeem).toHaveBeenCalledTimes(1);
    const redirect = setup();
    await redirect.player.signInWithProvider("GOOGLE");
    expect(redirect.store.has(MERGE_TOKEN_KEY)).toBe(true);
    expect(await redirect.player.me()).toEqual(GUEST);
    expect(redirect.api.redeem).not.toHaveBeenCalled();
    expect(store.has(MERGE_TOKEN_KEY)).toBe(false);
  });

  it("finishes on the next load, keeps the token after a network failure, and drops refused or expired ones", async () => {
    const { player, api, store } = setup(ACCOUNT);
    store.set(MERGE_TOKEN_KEY, JSON.stringify({ token: "t".repeat(43), expiresAt: LATER }));
    api.redeem.mockRejectedValueOnce(new Error("offline"));
    await player.me();
    expect(store.has(MERGE_TOKEN_KEY)).toBe(true);
    api.redeem.mockRejectedValueOnce({ response: { statusCode: 503 } });
    await player.me();
    expect(store.has(MERGE_TOKEN_KEY)).toBe(true);
    api.redeem.mockRejectedValueOnce(
      new ApiRequestError(422, { code: "VALIDATION_ERROR", message: "used" }),
    );
    await player.me();
    expect(store.has(MERGE_TOKEN_KEY)).toBe(false);
    store.set(
      MERGE_TOKEN_KEY,
      JSON.stringify({ token: "t".repeat(43), expiresAt: "2026-11-21T11:00:00.000Z" }),
    );
    await player.me();
    expect(store.has(MERGE_TOKEN_KEY)).toBe(false);
    store.set(MERGE_TOKEN_KEY, JSON.stringify({ expiresAt: LATER }));
    await player.me();
    expect(store.has(MERGE_TOKEN_KEY)).toBe(false);
    api.redeem.mockRejectedValueOnce("odd");
    store.set(MERGE_TOKEN_KEY, JSON.stringify({ token: "t".repeat(43), expiresAt: LATER }));
    await player.me();
    expect(store.has(MERGE_TOKEN_KEY)).toBe(true);
  });

  it("signs in without a token when issuing fails, and issues none for an account", async () => {
    const { player, api } = setup();
    api.issue.mockRejectedValueOnce(new Error("offline"));
    expect(await player.signIn("a@x.y", "pw")).toEqual(ACCOUNT);
    expect(api.redeem).not.toHaveBeenCalled();
    const signedIn = setup(ACCOUNT);
    await signedIn.player.signIn("a@x.y", "pw");
    expect(signedIn.api.issue).not.toHaveBeenCalled();
  });

  it("reads the real clock by default", async () => {
    const { api, inner } = setup(ACCOUNT);
    const store = new Map([
      [
        MERGE_TOKEN_KEY,
        JSON.stringify({ token: "t".repeat(43), expiresAt: "2999-01-01T00:00:00.000Z" }),
      ],
    ]);
    const player = withGuestMerge(inner, api, {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    });
    await player.me();
    expect(api.redeem).toHaveBeenCalledTimes(1);
  });

  it("links accounts: the token keeps the source, and the device signs out after redemption", async () => {
    const { player, api, store } = setup(ACCOUNT);
    expect(await player.startLink()).toEqual(GUEST);
    const stored = JSON.parse(store.get(MERGE_TOKEN_KEY) ?? "{}") as { keep?: string };
    expect(stored.keep).toBe("SOURCE");
    /* Signing in with the other method keeps the link token rather than issuing a guest one. */
    expect(await player.signIn("b@x.y", "pw")).toEqual(GUEST);
    expect(api.issue).toHaveBeenCalledTimes(1);
    expect(api.redeem).toHaveBeenCalledWith("t".repeat(43), "SOURCE");
    expect(store.has(MERGE_TOKEN_KEY)).toBe(false);
    await expect(setup(GUEST).player.startLink()).rejects.toThrow("Sign in before linking");
  });

  it("stays signed in when a link is refused", async () => {
    const { player, api, store } = setup(ACCOUNT);
    await player.startLink();
    api.redeem.mockRejectedValueOnce(
      new ApiRequestError(400, { code: "VALIDATION_ERROR", message: "same" }),
    );
    expect(await player.signIn("a@x.y", "pw")).toEqual(ACCOUNT);
    expect(store.has(MERGE_TOKEN_KEY)).toBe(false);
  });
});
