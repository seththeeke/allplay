import {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { GamesPlayedSchema, type GamesPlayed } from "../../models/gamesPlayed";
import { PlayerSchema, type Player } from "../../models/player";

import {
  conditionFailed,
  documentClient,
  queryAll,
  updateExpression,
  type DocumentSender,
} from "../dynamo";
import {
  PlayerExistsError,
  PlayerMissingError,
  TOUCH_INTERVAL_MS,
  type EmailEntry,
  type EmailMatch,
  type PlayerDao,
} from "./playerDao";

/** A rollup scan row (data-model.md section 11). */
const RollupPlayerSchema = PlayerSchema.pick({
  kind: true,
  status: true,
  lastActiveAt: true,
  createdAt: true,
});

/** Attributes stored as DynamoDB string sets (data-model.md section 4). */
const SET_FIELDS = [
  "identityIds",
  "signInProviders",
  "mergedGuestIds",
  "mergedAccountIds",
] as const;

/** Arrays to string sets; an empty set cannot be stored, so it is left out. */
function toItem(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const sets: ReadonlySet<string> = new Set(SET_FIELDS);
  return Object.fromEntries(
    Object.entries(fields).flatMap(([field, value]) => {
      if (!sets.has(field) || !Array.isArray(value)) return [[field, value]];
      return value.length === 0 ? [] : [[field, new Set(value as string[])]];
    }),
  );
}

/** String sets back to sorted arrays; a missing `identityIds` is an empty list. */
function fromItem(item: Record<string, unknown>): Player {
  const fields: Record<string, unknown> = { ...item, identityIds: item["identityIds"] ?? [] };
  for (const field of SET_FIELDS) {
    const value = fields[field];
    if (value instanceof Set) fields[field] = [...(value as Set<string>)].sort();
  }
  return PlayerSchema.parse(fields);
}

/** One `ByEmail` index item as the DAO returns it. */
function emailEntry(item: Record<string, unknown>): EmailEntry {
  const providers = item["signInProviders"];
  return {
    emailKey: item["emailKey"] as string,
    playerId: item["playerId"] as string,
    status: item["status"] as EmailMatch["status"],
    signInProviders:
      providers instanceof Set
        ? [...(providers as Set<EmailMatch["signInProviders"][number]>)].sort()
        : [],
    createdAt: item["createdAt"] as string,
  };
}

/**
 * PlayerDao over the `AllPlay-Players-<Stage>` table (data-model.md section 4).
 * Reads of the table are strongly consistent, so a player sees their own
 * writes; the `ByEmail` index is eventually consistent, as every GSI is.
 */
export function createDynamoPlayerDao(
  tableName: string,
  client: DocumentSender = documentClient(),
): PlayerDao {
  const counterNames = {
    "#gp": "gamesPlayed",
    "#c": "count",
    "#p": "period",
    "#ws": "windowStart",
  };
  /* The stored window's count goes up by one, below the limit when there is one. */
  const addToWindow = async (
    playerId: string,
    window: Pick<GamesPlayed, "period" | "windowStart">,
    limit: number | null,
    at: string,
  ): Promise<GamesPlayed | null> => {
    try {
      const out = (await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { playerId },
          UpdateExpression: "SET #gp.#c = #gp.#c + :one, updatedAt = :at",
          ConditionExpression: `#gp.#p = :p AND #gp.#ws = :ws${limit === null ? "" : " AND #gp.#c < :limit"}`,
          ExpressionAttributeNames: counterNames,
          ExpressionAttributeValues: {
            ":one": 1,
            ":at": at,
            ":p": window.period,
            ":ws": window.windowStart,
            ...(limit === null ? {} : { ":limit": limit }),
          },
          ReturnValues: "ALL_NEW",
        }),
      )) as { Attributes?: Record<string, unknown> };
      return GamesPlayedSchema.parse(out.Attributes?.["gamesPlayed"]);
    } catch (error) {
      if (conditionFailed(error)) return null;
      throw error;
    }
  };
  /* A window not yet counted starts at 1; a missing player is created from the seed. */
  const startWindow = async (
    playerId: string,
    window: Pick<GamesPlayed, "period" | "windowStart">,
    at: string,
    seed: Player,
  ): Promise<GamesPlayed | null> => {
    const fresh: GamesPlayed = { ...window, count: 1 };
    /* The key, the counter and the stamp are written by this update itself. */
    const initial = Object.fromEntries(
      Object.entries(toItem(PlayerSchema.parse(seed))).filter(
        ([field]) => !["playerId", "gamesPlayed", "updatedAt"].includes(field),
      ),
    );
    const expression = updateExpression({ gamesPlayed: fresh, updatedAt: at }, [], initial);
    try {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { playerId },
          ...expression,
          ConditionExpression: "attribute_not_exists(#gp) OR #gp.#p <> :p OR #gp.#ws <> :ws",
          ExpressionAttributeNames: { ...expression.ExpressionAttributeNames, ...counterNames },
          ExpressionAttributeValues: {
            ...expression.ExpressionAttributeValues,
            ":p": window.period,
            ":ws": window.windowStart,
          },
        }),
      );
      return fresh;
    } catch (error) {
      if (conditionFailed(error)) return null;
      throw error;
    }
  };
  return {
    countGame: async (playerId, window, limit, at, seed) => {
      if (limit !== null && limit < 1) return null;
      const added = await addToWindow(playerId, window, limit, at);
      if (added !== null) return added;
      const started = await startWindow(playerId, window, at, seed);
      if (started !== null) return started;
      /* Another start opened this window between the two writes; count against it once more. */
      return addToWindow(playerId, window, limit, at);
    },
    giveBackGame: async (playerId, window, at) => {
      try {
        await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { playerId },
            UpdateExpression: "SET #gp.#c = #gp.#c - :one, updatedAt = :at",
            ConditionExpression: "#gp.#p = :p AND #gp.#ws = :ws AND #gp.#c > :zero",
            ExpressionAttributeNames: counterNames,
            ExpressionAttributeValues: {
              ":one": 1,
              ":zero": 0,
              ":at": at,
              ":p": window.period,
              ":ws": window.windowStart,
            },
          }),
        );
      } catch (error) {
        if (!conditionFailed(error)) throw error;
      }
    },
    get: async (playerId) => {
      const out = (await client.send(
        new GetCommand({ TableName: tableName, Key: { playerId }, ConsistentRead: true }),
      )) as {
        Item?: Record<string, unknown>;
      };
      return out.Item === undefined ? null : fromItem(out.Item);
    },
    create: async (player) => {
      try {
        await client.send(
          new PutCommand({
            TableName: tableName,
            Item: toItem(PlayerSchema.parse(player)),
            ConditionExpression: "attribute_not_exists(playerId)",
          }),
        );
      } catch (error) {
        if (conditionFailed(error)) throw new PlayerExistsError(player.playerId);
        throw error;
      }
    },
    update: async (playerId, changes, at, remove = []) => {
      const expression = updateExpression(toItem({ ...changes, updatedAt: at }), remove);
      try {
        const out = (await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { playerId },
            ...expression,
            ExpressionAttributeNames: { ...expression.ExpressionAttributeNames, "#pk": "playerId" },
            ConditionExpression: "attribute_exists(#pk)",
            ReturnValues: "ALL_NEW",
          }),
        )) as { Attributes?: Record<string, unknown> };
        return fromItem(out.Attributes ?? {});
      } catch (error) {
        if (conditionFailed(error)) throw new PlayerMissingError(playerId);
        throw error;
      }
    },
    touch: async (playerId, at, ttl) => {
      const stamp = at.toISOString();
      const expression = updateExpression({ lastActiveAt: stamp, updatedAt: stamp, ttl });
      try {
        await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { playerId },
            ...expression,
            ExpressionAttributeNames: {
              ...expression.ExpressionAttributeNames,
              "#pk": "playerId",
              "#last": "lastActiveAt",
            },
            ExpressionAttributeValues: {
              ...expression.ExpressionAttributeValues,
              ":cutoff": new Date(at.getTime() - TOUCH_INTERVAL_MS).toISOString(),
            },
            ConditionExpression: "attribute_exists(#pk) AND #last <= :cutoff",
          }),
        );
        return true;
      } catch (error) {
        if (conditionFailed(error)) return false;
        throw error;
      }
    },
    listByEmail: async (emailKey) => {
      const matches: EmailMatch[] = [];
      let start: Record<string, unknown> | undefined;
      do {
        const out = (await client.send(
          new QueryCommand({
            TableName: tableName,
            IndexName: "ByEmail",
            KeyConditionExpression: "emailKey = :e",
            ExpressionAttributeValues: { ":e": emailKey },
            ExclusiveStartKey: start,
          }),
        )) as { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> };
        for (const item of out.Items ?? []) {
          const entry = emailEntry(item);
          matches.push({
            playerId: entry.playerId,
            status: entry.status,
            signInProviders: entry.signInProviders,
            createdAt: entry.createdAt,
          });
        }
        start = out.LastEvaluatedKey;
      } while (start !== undefined);
      return matches;
    },
    listForRollup: async () =>
      (
        await queryAll(
          client,
          (start) =>
            new ScanCommand({
              TableName: tableName,
              ProjectionExpression: "#kind, #status, lastActiveAt, createdAt",
              ExpressionAttributeNames: { "#kind": "kind", "#status": "status" },
              ExclusiveStartKey: start,
            }),
        )
      ).map((item) => RollupPlayerSchema.parse(item)),
    listAllEmails: async () => {
      const entries: EmailEntry[] = [];
      let start: Record<string, unknown> | undefined;
      do {
        const out = (await client.send(
          new ScanCommand({ TableName: tableName, IndexName: "ByEmail", ExclusiveStartKey: start }),
        )) as { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> };
        entries.push(...(out.Items ?? []).map(emailEntry));
        start = out.LastEvaluatedKey;
      } while (start !== undefined);
      return entries;
    },
  };
}
