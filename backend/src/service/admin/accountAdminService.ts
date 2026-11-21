import { createDynamoPlayerDao } from "../../dao/player/dynamoPlayerDao";
import type { PlayerDao } from "../../dao/player/playerDao";
import type { DuplicateAccountsResponse, MergeResponse } from "../../models/api";
import { createDeployedMergeService, type MergeService } from "../player/mergeService";

/** Duplicate accounts and their merge, for admins (authn-authz.md section 6.2, step 4). */
export interface AccountAdminService {
  duplicates(): Promise<DuplicateAccountsResponse>;
  merge(primaryPlayerId: string, duplicatePlayerId: string): Promise<MergeResponse>;
}

export function createAccountAdminService(
  players: PlayerDao,
  merge: MergeService,
): AccountAdminService {
  return {
    duplicates: async () => {
      const groups = new Map<string, DuplicateAccountsResponse["duplicates"][number]["accounts"]>();
      for (const entry of await players.listAllEmails()) {
        if (entry.status !== "ACTIVE") continue;
        const accounts = groups.get(entry.emailKey) ?? [];
        accounts.push({
          playerId: entry.playerId,
          signInProviders: entry.signInProviders,
          createdAt: entry.createdAt,
        });
        groups.set(entry.emailKey, accounts);
      }
      return {
        duplicates: [...groups.entries()]
          .filter(([, accounts]) => accounts.length > 1)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([emailKey, accounts]) => ({
            emailKey,
            accounts: accounts.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
          })),
      };
    },
    merge: (primaryPlayerId, duplicatePlayerId) =>
      merge.mergeAccounts(primaryPlayerId, duplicatePlayerId),
  };
}

/** The admin account service over the deployed tables and User Pool. */
export function createDeployedAccountAdminService(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AccountAdminService {
  return createAccountAdminService(
    createDynamoPlayerDao(env["PLAYERS_TABLE"] ?? ""),
    createDeployedMergeService(env),
  );
}
