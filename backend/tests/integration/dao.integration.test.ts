import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { documentClient } from "../../src/dao/dynamo";
import { createDynamoPlayerDao } from "../../src/dao/player/dynamoPlayerDao";
import { createDynamoPreferenceDao } from "../../src/dao/preference/dynamoPreferenceDao";
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
