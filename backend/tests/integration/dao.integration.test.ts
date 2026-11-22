import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { documentClient } from "../../src/dao/dynamo";
import { createHash } from "node:crypto";
import { createDynamoMergeTokenDao } from "../../src/dao/mergeToken/dynamoMergeTokenDao";
import { createDynamoPlayerDao } from "../../src/dao/player/dynamoPlayerDao";
import { createDynamoGameSessionDao } from "../../src/dao/gameSession/dynamoGameSessionDao";
import { createDynamoPlayerStatsDao } from "../../src/dao/playerStats/dynamoPlayerStatsDao";
import { createDynamoMetricRollupDao } from "../../src/dao/metricRollup/dynamoMetricRollupDao";
import { createDynamoPreferenceDao } from "../../src/dao/preference/dynamoPreferenceDao";
import { metricRollupDaoContract } from "../dao/metricRollup/metricRollupDaoContract";
import { createDynamoRateLimitCounterDao } from "../../src/dao/rateLimitCounter/dynamoRateLimitCounterDao";
import { rateLimitCounterDaoContract } from "../dao/rateLimitCounter/rateLimitCounterDaoContract";
import { createDynamoSeatAssignmentDao } from "../../src/dao/seatAssignment/dynamoSeatAssignmentDao";
import { gameSessionDaoContract, type GameTables } from "../dao/gameSession/gameSessionDaoContract";
import { mergeTokenDaoContract } from "../dao/mergeToken/mergeTokenDaoContract";
import { playerDaoContract } from "../dao/player/playerDaoContract";
import { preferenceDaoContract } from "../dao/preference/preferenceDaoContract";
import { cleanUp, describeWrites, runId } from "./stage";

/*
 * The DAO contracts against the Test stage's real tables (data-model.md
 * section 1, cdk-stacks.md section 7). Every key carries this run's id, and
 * every item written is deleted after the file's tests.
 */
const RUN = runId();
const client = documentClient();
const table = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Set ${name} to run the DAO integration tests.`);
  return value;
};

/** Ids made for this run, remembered so clean-up can delete what the contracts wrote. */
const made = new Set<string>();
const id = (name: string): string => {
  const value = `${RUN}-${name}`;
  made.add(value);
  return value;
};

/* Table names are read when a test runs, not when the suite is collected, so a skipped suite needs none. */
describeWrites("Players table", () => {
  const tableName = (): string => table("PLAYERS_TABLE");
  cleanUp(() =>
    Promise.all(
      [...made].flatMap((value) =>
        ["GUEST#", "ACCT#"].map((prefix) =>
          client.send(
            new DeleteCommand({ TableName: tableName(), Key: { playerId: `${prefix}${value}` } }),
          ),
        ),
      ),
    ),
  );
  playerDaoContract(() => createDynamoPlayerDao(tableName(), client), id);
});

describeWrites("Preferences table", () => {
  const tableName = (): string => table("PREFERENCES_TABLE");
  cleanUp(() =>
    Promise.all(
      [...made].flatMap((value) =>
        ["APP", "GAME#spider-solitaire"].map((scope) =>
          client.send(
            new DeleteCommand({
              TableName: tableName(),
              Key: { playerId: `GUEST#${value}`, scope },
            }),
          ),
        ),
      ),
    ),
  );
  preferenceDaoContract(() => createDynamoPreferenceDao(tableName(), client), id);
});

describeWrites("MergeTokens table", () => {
  const tableName = (): string => table("MERGE_TOKENS_TABLE");
  const hashes = new Set<string>();
  const hash = (name: string): string => {
    const value = createHash("sha256").update(`${RUN}-${name}`).digest("hex");
    hashes.add(value);
    return value;
  };
  cleanUp(() =>
    Promise.all(
      [...hashes].map((tokenHash) =>
        client.send(new DeleteCommand({ TableName: tableName(), Key: { tokenHash } })),
      ),
    ),
  );
  mergeTokenDaoContract(() => createDynamoMergeTokenDao(tableName(), client), hash, id);
});

describeWrites("GameSessions, SeatAssignments and PlayerStats tables", () => {
  const tables = (): GameTables => {
    const names = {
      sessions: table("GAME_SESSIONS_TABLE"),
      seats: table("SEAT_ASSIGNMENTS_TABLE"),
      stats: table("PLAYER_STATS_TABLE"),
    };
    return {
      dao: createDynamoGameSessionDao(names, client),
      seats: createDynamoSeatAssignmentDao(names.seats, client),
      stats: createDynamoPlayerStatsDao(names.stats, client),
    };
  };
  cleanUp(async () => {
    const { dao, seats, stats } = tables();
    for (const value of made) {
      for (const playerId of [`GUEST#${value}`, `ACCT#${value}`]) {
        for (const seat of await seats.list(playerId)) await seats.delete(playerId, seat.sessionId);
        for (const item of await stats.list(playerId)) await stats.delete(playerId, item.statsKey);
      }
      await dao.delete(value);
    }
  });
  gameSessionDaoContract(tables, id);
});

describeWrites("RateLimits table", () => {
  const tableName = (): string => table("RATE_LIMITS_TABLE");
  cleanUp(() =>
    Promise.all(
      [...made].map((value) =>
        client.send(
          new DeleteCommand({
            TableName: tableName(),
            Key: { counterKey: `GUEST#${value}#MIN#2026-11-22T10:00` },
          }),
        ),
      ),
    ),
  );
  rateLimitCounterDaoContract(() => createDynamoRateLimitCounterDao(tableName(), client), id);
});

/* A day long before All Play existed, so the contract never touches a real day's counters. */
describeWrites("MetricRollups table", () => {
  const tableName = (): string => table("METRIC_ROLLUPS_TABLE");
  const PERIOD = "2000-01-01";
  cleanUp(() =>
    client.send(
      new DeleteCommand({ TableName: tableName(), Key: { rollupType: "DAY", period: PERIOD } }),
    ),
  );
  /* One DAO for the file: a container writes each day empty once, as the deployed one does. */
  let dao: ReturnType<typeof createDynamoMetricRollupDao> | undefined;
  metricRollupDaoContract(() => (dao ??= createDynamoMetricRollupDao(tableName(), client)), PERIOD);
});
