import { z } from "zod";
import type { Logger } from "../../logger";
import {
  createIamRolePolicyStore,
  type RolePolicyStore,
} from "../../dao/rolePolicy/rolePolicyStore";
import { createDynamoSystemFlagDao } from "../../dao/systemFlag/dynamoSystemFlagDao";
import type { SystemFlagDao } from "../../dao/systemFlag/systemFlagDao";
import type { SystemFlag } from "../../models/systemFlag";

/** The inline policy that stops browser Transcribe and Polly calls while the cord is pulled. */
export const ANDON_POLICY_NAME = "AllPlay-AndonDeny";

export const ANDON_DENY_POLICY = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "AndonCordPulled",
      Effect: "Deny",
      Action: ["transcribe:*", "polly:*"],
      Resource: "*",
    },
  ],
} as const;

/** The Identity Pool roles of one stage (authn-authz.md section 4). */
export function identityRoleNames(stage: string): string[] {
  return ["Guest", "Player", "PlayerPlus", "Admin"].map((tier) => `AllPlay-${tier}Role-${stage}`);
}

/** The cord's state as the admin page shows it; a missing item reads as not pulled. */
export interface AndonState {
  pulled: boolean;
  reason: string | null;
  pulledBy: SystemFlag["pulledBy"] | null;
  changedAt: string | null;
}

export interface AndonChange {
  pulled: boolean;
  reason: string;
  pulledBy: SystemFlag["pulledBy"];
  changedBy?: string;
}

/** Reads and changes one stage's andon cord (productionalization.md section 4). */
export interface AndonService {
  state(): Promise<AndonState>;
  /** Writes the flag, then puts or removes the deny policy on each Identity Pool role. */
  set(change: AndonChange): Promise<AndonState>;
}

export interface AndonServiceDeps {
  flags: SystemFlagDao;
  policies: RolePolicyStore;
  roleNames: readonly string[];
  now?: () => Date;
}

const stateOf = (flag: SystemFlag | null): AndonState => ({
  pulled: flag?.isAndonCordPulled ?? false,
  reason: flag?.reason ?? null,
  pulledBy: flag?.pulledBy ?? null,
  changedAt: flag?.changedAt ?? null,
});

export function createAndonService(deps: AndonServiceDeps): AndonService {
  const now = deps.now ?? (() => new Date());
  return {
    state: async () => stateOf(await deps.flags.get("ANDON")),
    set: async (change) => {
      const at = now().toISOString();
      const flag = await deps.flags.put({
        flagId: "ANDON",
        isAndonCordPulled: change.pulled,
        reason: change.reason,
        pulledBy: change.pulledBy,
        changedAt: at,
        ...(change.changedBy === undefined ? {} : { changedBy: change.changedBy }),
        entityVersion: 1,
        createdAt: at,
        updatedAt: at,
      });
      for (const role of deps.roleNames) {
        if (change.pulled) await deps.policies.put(role, ANDON_POLICY_NAME, ANDON_DENY_POLICY);
        else await deps.policies.remove(role, ANDON_POLICY_NAME);
      }
      return stateOf(flag);
    },
  };
}

/** Answers whether the cord is pulled, as the router asks before each controller. */
export interface AndonGate {
  isPulled(): Promise<boolean>;
}

/**
 * The flag cached for `cacheMs` per container (productionalization.md
 * section 4.3). A failed read is logged and treated as not pulled, so a
 * flag table outage never stops play.
 */
export function createAndonGate(
  flags: Pick<SystemFlagDao, "get">,
  logger: Logger,
  cacheMs = 30_000,
  now: () => number = Date.now,
): AndonGate {
  let cached: { pulled: boolean; at: number } | null = null;
  return {
    isPulled: async () => {
      if (cached !== null && now() - cached.at < cacheMs) return cached.pulled;
      try {
        const flag = await flags.get("ANDON");
        cached = { pulled: flag?.isAndonCordPulled ?? false, at: now() };
      } catch (error) {
        logger.warn("ANDON_FLAG_UNREADABLE", { error: String(error) });
        return false;
      }
      return cached.pulled;
    },
  };
}

/** The stage's andon service over its `SystemFlags` table and Identity Pool roles. */
export function createDeployedAndonService(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AndonService {
  return createAndonService({
    flags: createDynamoSystemFlagDao(env["SYSTEM_FLAGS_TABLE"] ?? ""),
    policies: createIamRolePolicyStore(),
    roleNames: identityRoleNames(env["STAGE"] ?? ""),
  });
}

/** The router's check over the table named by SYSTEM_FLAGS_TABLE, or undefined where it is not set. */
export function createDeployedAndonGate(
  logger: Logger,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AndonGate | undefined {
  const table = env["SYSTEM_FLAGS_TABLE"];
  return table === undefined || table === ""
    ? undefined
    : createAndonGate(createDynamoSystemFlagDao(table), logger);
}

/** Each stage the cord stops: its stage name and `SystemFlags` table. */
const AndonTargetsSchema = z
  .array(z.object({ stage: z.string().min(1), table: z.string().min(1) }))
  .min(1);

/** The stages named by ANDON_TARGETS, a JSON list the pipeline stack writes (productionalization.md section 4.2). */
export function andonStagesFrom(
  env: Readonly<Record<string, string | undefined>>,
): { stage: string; andon: AndonService }[] {
  const policies = createIamRolePolicyStore();
  return AndonTargetsSchema.parse(JSON.parse(env["ANDON_TARGETS"] ?? "[]")).map(
    ({ stage, table }) => ({
      stage,
      andon: createAndonService({
        flags: createDynamoSystemFlagDao(table),
        policies,
        roleNames: identityRoleNames(stage),
      }),
    }),
  );
}
