import { randomBytes } from "node:crypto";
import { accountSettings, createTestAccount, deleteTestAccount } from "./testAccounts";

/*
 * The browser smoke tests' account in an invite-only stage
 * (productionalization.md section 3). `create` makes a run-scoped account and
 * prints SMOKE_EMAIL and SMOKE_PASSWORD as shell assignments; `delete` removes
 * the account named by SMOKE_EMAIL. Run by the pipeline's verification step.
 */
async function main(command: string | undefined): Promise<void> {
  const settings = accountSettings();
  if (settings === undefined) throw new Error("The integration accounts settings are not set.");
  if (command === "create") {
    const email = `itest-smoke-${randomBytes(6).toString("hex")}@example.com`;
    const account = await createTestAccount(settings, email);
    process.stdout.write(`SMOKE_EMAIL='${account.email}'\nSMOKE_PASSWORD='${account.password}'\n`);
    return;
  }
  if (command === "delete") {
    await deleteTestAccount(settings, process.env["SMOKE_EMAIL"] ?? "");
    return;
  }
  throw new Error("Use create or delete.");
}

await main(process.argv[2]);
