import { createAppleClient, type AppleClient } from "../../dao/apple/appleClient";
import type { PlayerDao } from "../../dao/player/playerDao";
import {
  createFederationSecretReader,
  type AppleCredentials,
} from "../../dao/secrets/federationSecret";
import type { Logger } from "../../logger";
import type { IdentityService } from "./identityService";
import type { PlayerService } from "./playerService";

export interface AppleServiceDeps {
  credentials: () => Promise<AppleCredentials | null>;
  apple: AppleClient;
  identities: IdentityService;
  userPoolId: string;
  players: PlayerDao;
  accounts: PlayerService;
  logger: Logger;
  now?: () => Date;
}

export interface AppleService {
  /**
   * Revokes the player's Sign in with Apple tokens with a fresh authorization
   * code (Apple TN3194). Returns whether it revoked; any failure is logged and
   * never stops the account deletion that follows.
   */
  revokeForDeletion(code: string | undefined): Promise<boolean>;
  /**
   * Handles one server-to-server notification (authn-authz.md section 12):
   * `consent-revoked` and `account-delete(d)` delete the account, and the
   * email events set `relayEmailEnabled`. Returns what it did.
   */
  handleNotification(payload: string): Promise<string>;
}

export function createAppleService(deps: AppleServiceDeps): AppleService {
  const now = deps.now ?? (() => new Date());
  return {
    revokeForDeletion: async (code) => {
      if (code === undefined || code === "") return false;
      try {
        const credentials = await deps.credentials();
        if (credentials === null) {
          deps.logger.warn(
            "Apple revocation skipped: the federation secret has no Apple values yet",
          );
          return false;
        }
        await deps.apple.revokeWithCode(credentials, code);
        return true;
      } catch (error) {
        deps.logger.error("Apple token revocation failed; deletion continues", { error });
        return false;
      }
    },
    handleNotification: async (payload) => {
      const credentials = await deps.credentials();
      if (credentials === null) throw new Error("Apple is not configured");
      const event = await deps.apple.verifyNotification(credentials, payload);
      const playerId = await deps.identities.playerIdForApple(deps.userPoolId, event.sub);
      if (playerId === null) return "NO_ACCOUNT";
      if (event.type === "email-disabled" || event.type === "email-enabled") {
        await deps.players.update(
          playerId,
          { relayEmailEnabled: event.type === "email-enabled" },
          now().toISOString(),
        );
        return event.type === "email-enabled" ? "RELAY_ENABLED" : "RELAY_DISABLED";
      }
      await deps.accounts.deleteAccount({ playerId, tier: "PLAYER", identityId: "" });
      return "ACCOUNT_DELETED";
    },
  };
}

/** The Apple service over the deployed secret, Apple's API and the User Pool. */
export function createDeployedAppleService(
  deps: Pick<AppleServiceDeps, "identities" | "players" | "accounts" | "logger">,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AppleService {
  return createAppleService({
    ...deps,
    credentials: createFederationSecretReader(env["FEDERATION_SECRET_ID"] ?? ""),
    apple: createAppleClient(),
    userPoolId: env["USER_POOL_ID"] ?? "",
  });
}
