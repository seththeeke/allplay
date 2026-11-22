import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, describe, expect, it } from "vitest";
import { documentClient } from "../../src/dao/dynamo";
import {
  AdminDecisionsResponseSchema,
  DeploymentsResponseSchema,
  MetricsResponseSchema,
  DuplicateAccountsResponseSchema,
  MergeResponseSchema,
  MergeTokenResponseSchema,
  PlayerMeSchema,
  PreferencesResponseSchema,
} from "../../src/models/api";
import { apiUrl } from "./apiUrl";
import { guestCredentials, signedFetch, type GuestCredentials } from "./guestCredentials";
import { cleanUp, runId, writesAllowed } from "./stage";
import {
  accountCredentials,
  accountSettings,
  createTestAccount,
  deleteTestAccount,
  signIn,
  type TestAccount,
} from "./testAccounts";

/*
 * Every tier against Test's real User Pool, Identity Pool, IAM routes and
 * tables (authn-authz.md section 10): a player and an admin created for this
 * run, the routes each may and may not call, and the full guest merge. Runs
 * only where writes are allowed; accounts and their items are deleted after.
 */
const settings = accountSettings();
const RUN = runId();
const url = (path: string) => new URL(path, apiUrl());

describe.runIf(writesAllowed() && settings !== undefined)("tiers with real accounts", () => {
  const config = settings ?? { userPoolId: "", clientId: "", identityPoolId: "", roleName: "" };
  const made: TestAccount[] = [];
  const items: [string, Record<string, string>][] = [];
  let player: GuestCredentials;
  let admin: GuestCredentials;
  let playerAccount: TestAccount;

  const signedInAs = async (label: string, groups: string[] = []) => {
    const account = await createTestAccount(config, `${RUN}-${label}@example.com`, groups);
    made.push(account);
    items.push([process.env["PLAYERS_TABLE"] ?? "", { playerId: `ACCT#${account.sub}` }]);
    items.push([
      process.env["PREFERENCES_TABLE"] ?? "",
      { playerId: `ACCT#${account.sub}`, scope: "APP" },
    ]);
    return {
      account,
      credentials: await accountCredentials(config, await signIn(config, account)),
    };
  };

  beforeAll(async () => {
    const asPlayer = await signedInAs("player");
    player = asPlayer.credentials;
    playerAccount = asPlayer.account;
    admin = (await signedInAs("admin", ["ADMIN"])).credentials;
  }, 60_000);

  cleanUp(async () => {
    for (const account of made) await deleteTestAccount(config, account.email);
    const client = documentClient();
    await Promise.all(
      items.map(([TableName, Key]) => client.send(new DeleteCommand({ TableName, Key }))),
    );
  });

  it("serves a player their account and refuses them the admin routes", async () => {
    const me = await signedFetch(url("v1/players/me"), player);
    expect(me.status).toBe(200);
    expect(PlayerMeSchema.parse(await me.json())).toMatchObject({
      playerId: `ACCT#${playerAccount.sub}`,
      kind: "ACCOUNT",
      tier: "PLAYER",
      email: playerAccount.email,
    });
    for (const path of [
      "v1/admin/deployments",
      "v1/admin/players/duplicates",
      "v1/admin/metrics?from=2026-11-01&to=2026-11-02",
    ])
      expect((await signedFetch(url(path), player)).status).toBe(403);
  });

  it("serves an admin the admin routes", async () => {
    const me = PlayerMeSchema.parse(await (await signedFetch(url("v1/players/me"), admin)).json());
    expect(me.tier).toBe("ADMIN");
    const deployments = await signedFetch(url("v1/admin/deployments"), admin);
    expect(deployments.status).toBe(200);
    expect(
      DeploymentsResponseSchema.parse(await deployments.json()).deployments.length,
    ).toBeGreaterThan(0);
    const duplicates = await signedFetch(url("v1/admin/players/duplicates"), admin);
    expect(duplicates.status).toBe(200);
    DuplicateAccountsResponseSchema.parse(await duplicates.json());
    const today = new Date().toISOString().slice(0, 10);
    const metrics = await signedFetch(url(`v1/admin/metrics?from=${today}&to=${today}`), admin);
    expect(metrics.status).toBe(200);
    MetricsResponseSchema.parse(await metrics.json());
    /* Failure browsing is a Logs Insights query over the turn log (action-decision.md section 9.1). */
    const failures = await signedFetch(url(`v1/admin/decisions?day=${today}`), admin);
    expect(failures.status).toBe(200);
    AdminDecisionsResponseSchema.parse(await failures.json());
  });

  it("merges a guest's preferences into the account that signs in", async () => {
    const guest = await guestCredentials(config.identityPoolId);
    items.push([process.env["PLAYERS_TABLE"] ?? "", { playerId: `GUEST#${guest.identityId}` }]);
    items.push([
      process.env["PREFERENCES_TABLE"] ?? "",
      { playerId: `GUEST#${guest.identityId}`, scope: "APP" },
    ]);
    const patched = await signedFetch(url("v1/players/me/preferences/APP"), guest, {
      method: "PATCH",
      body: { zoomLevel: 2.75 },
    });
    expect(patched.status).toBe(200);
    const issued = await signedFetch(url("v1/players/me/merge-tokens"), guest, { method: "POST" });
    const { token } = MergeTokenResponseSchema.parse(await issued.json());
    expect(
      (await signedFetch(url("v1/players/me/merge"), guest, { method: "POST", body: { token } }))
        .status,
    ).toBe(403);
    const merged = await signedFetch(url("v1/players/me/merge"), player, {
      method: "POST",
      body: { token },
    });
    expect(merged.status).toBe(200);
    expect(MergeResponseSchema.parse(await merged.json())).toEqual({
      primaryPlayerId: `ACCT#${playerAccount.sub}`,
      mergedPlayerId: `GUEST#${guest.identityId}`,
    });
    const preferences = await signedFetch(url("v1/players/me/preferences"), player);
    expect(PreferencesResponseSchema.parse(await preferences.json()).app.zoomLevel).toBe(2.75);
  });
});
