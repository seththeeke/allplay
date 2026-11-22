import { DeleteCommand, GetCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { GameSessionSchema, type GameSession } from "../../models/gameSession";
import { SeatAssignmentSchema, type SeatAssignment } from "../../models/seatAssignment";
import { conditionFailed, documentClient, failedConditions, type DocumentSender } from "../dynamo";
import { statsPut } from "../playerStats/dynamoPlayerStatsDao";
import { StatsVersionConflictError } from "../playerStats/playerStatsDao";
import { decodeGameState, encodeGameState } from "./gameStateCodec";
import {
  SessionExistsError,
  SessionVersionConflictError,
  type GameSessionDao,
} from "./gameSessionDao";

/** The three tables a session's transactions write (data-model.md section 6). */
export interface GameTableNames {
  sessions: string;
  seats: string;
  stats: string;
}

function toItem(session: GameSession): Record<string, unknown> {
  const parsed = GameSessionSchema.parse(session);
  return { ...parsed, state: encodeGameState(parsed.state) };
}

function fromItem(item: Record<string, unknown>): GameSession {
  return GameSessionSchema.parse({ ...item, state: decodeGameState(item["state"] as Uint8Array) });
}

/**
 * GameSessionDao over `AllPlay-GameSessions-<Stage>`. A move is one
 * conditional put; starting and ending a session are transactions with the
 * seats and stats tables (data-model.md sections 6 to 8).
 */
export function createDynamoGameSessionDao(
  tables: GameTableNames,
  client: DocumentSender = documentClient(),
): GameSessionDao {
  const seatPut = (seat: SeatAssignment) => ({
    Put: { TableName: tables.seats, Item: SeatAssignmentSchema.parse(seat) },
  });
  const versionIs = (expectedVersion: number) => ({
    ConditionExpression: "#version = :expected",
    ExpressionAttributeNames: { "#version": "version" },
    ExpressionAttributeValues: { ":expected": expectedVersion },
  });
  return {
    create: async (session, seats) => {
      try {
        await client.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: tables.sessions,
                  Item: toItem(session),
                  ConditionExpression: "attribute_not_exists(sessionId)",
                },
              },
              ...seats.map(seatPut),
            ],
          }),
        );
      } catch (error) {
        if (failedConditions(error)?.includes(0) === true)
          throw new SessionExistsError(session.sessionId);
        throw error;
      }
    },
    get: async (sessionId) => {
      const out = (await client.send(
        new GetCommand({ TableName: tables.sessions, Key: { sessionId }, ConsistentRead: true }),
      )) as { Item?: Record<string, unknown> };
      return out.Item === undefined ? null : fromItem(out.Item);
    },
    update: async (session, expectedVersion) => {
      try {
        await client.send(
          new PutCommand({
            TableName: tables.sessions,
            Item: toItem(session),
            ...versionIs(expectedVersion),
          }),
        );
      } catch (error) {
        if (conditionFailed(error)) throw new SessionVersionConflictError(session.sessionId);
        throw error;
      }
    },
    end: async (end) => {
      const condition = versionIs(end.expectedVersion);
      try {
        await client.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: tables.sessions,
                  Item: toItem(end.session),
                  ConditionExpression: `${condition.ConditionExpression} AND #status = :inProgress`,
                  ExpressionAttributeNames: {
                    ...condition.ExpressionAttributeNames,
                    "#status": "status",
                  },
                  ExpressionAttributeValues: {
                    ...condition.ExpressionAttributeValues,
                    ":inProgress": "IN_PROGRESS",
                  },
                },
              },
              ...end.seats.map(seatPut),
              ...end.stats.map((write) => statsPut(tables.stats, write)),
            ],
          }),
        );
      } catch (error) {
        const failed = failedConditions(error);
        /* A transaction cancelled for any reason but a condition (a conflict, a throttle) surfaces as is. */
        if (failed === null || failed.length === 0) throw error;
        if (failed.includes(0)) throw new SessionVersionConflictError(end.session.sessionId);
        throw new StatsVersionConflictError(end.session.sessionId);
      }
    },
    delete: async (sessionId) => {
      await client.send(new DeleteCommand({ TableName: tables.sessions, Key: { sessionId } }));
    },
  };
}
