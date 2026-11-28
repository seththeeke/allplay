import { DeleteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { expect, it } from "vitest";
import { PreferencesResponseSchema } from "../../src/models/api";
import { apiUrl } from "./apiUrl";
import { playCredentials } from "./callers";
import { identityPoolId, signedFetch, type GuestCredentials } from "./guestCredentials";
import { CHANGED_SETTINGS } from "./settingsFixture";
import { cleanUp, describeWrites, localTarget } from "./stage";

/*
 * Every setting the Settings page saves comes back from the API
 * (productionalization.md section 12). Test only, since it writes; the
 * caller's preference and player items are deleted after the file.
 */
describeWrites("settings round trip", () => {
  let caller: GuestCredentials | undefined;
  cleanUp(async () => {
    if (caller === undefined || localTarget()) return;
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    await client.send(
      new DeleteCommand({
        TableName: process.env["PREFERENCES_TABLE"] ?? "",
        Key: { playerId: caller.playerId, scope: "APP" },
      }),
    );
    await client.send(
      new DeleteCommand({
        TableName: process.env["PLAYERS_TABLE"] ?? "",
        Key: { playerId: caller.playerId },
      }),
    );
  });

  it("saves every APP setting and reads each back", async () => {
    caller = await playCredentials(identityPoolId() ?? "");
    const saved = await signedFetch(new URL("v1/players/me/preferences/APP", apiUrl()), caller, {
      method: "PATCH",
      body: CHANGED_SETTINGS,
    });
    expect(saved.status).toBe(200);
    const read = await signedFetch(new URL("v1/players/me/preferences", apiUrl()), caller);
    expect(PreferencesResponseSchema.parse(await read.json()).app).toEqual(CHANGED_SETTINGS);
  });
});
