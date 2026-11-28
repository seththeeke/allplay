import { randomBytes } from "node:crypto";
import { afterAll } from "vitest";
import { guestCredentials, type GuestCredentials } from "./guestCredentials";
import { runId } from "./stage";
import {
  accountCredentials,
  accountSettings,
  createTestAccount,
  deleteTestAccount,
  signIn,
} from "./testAccounts";

/** True when the stage takes no guests (productionalization.md section 3); the pipeline sets ACCESS_MODE for Test. */
export function inviteOnly(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env["ACCESS_MODE"] === "INVITE_ONLY";
}

const created: string[] = [];
afterAll(async () => {
  const settings = accountSettings();
  if (settings === undefined) return;
  for (const email of created.splice(0)) {
    try {
      await deleteTestAccount(settings, email);
    } catch (error) {
      process.stderr.write(`Integration account clean-up failed: ${String(error)}\n`);
    }
  }
});

/**
 * A new caller who plays: a guest where the stage allows guests, otherwise a
 * new signed-in account made for this run and deleted after the file. Tests
 * clean the caller's data by its `playerId`.
 */
export async function playCredentials(poolId: string): Promise<GuestCredentials> {
  if (!inviteOnly()) return guestCredentials(poolId);
  const settings = accountSettings();
  if (settings === undefined)
    throw new Error("An invite-only stage needs the integration accounts settings.");
  const email = `${runId()}-${randomBytes(4).toString("hex")}@example.com`;
  const account = await createTestAccount(settings, email);
  created.push(email);
  return accountCredentials(settings, await signIn(settings, account));
}
