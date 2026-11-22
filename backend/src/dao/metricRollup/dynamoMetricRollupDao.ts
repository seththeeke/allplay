import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { emptyDay, MetricRollupSchema } from "../../models/metricRollup";
import {
  conditionFailed,
  documentClient,
  queryAll,
  updateExpression,
  type DocumentSender,
} from "../dynamo";
import type { MetricRollupDao } from "./metricRollupDao";

/**
 * MetricRollupDao over `AllPlay-MetricRollups-<Stage>` (data-model.md
 * section 11). DynamoDB cannot `ADD` inside a map that does not exist, so a
 * container writes each day empty once (conditionally) before its first add.
 */
export function createDynamoMetricRollupDao(
  tableName: string,
  client: DocumentSender = documentClient(),
): MetricRollupDao {
  const created = new Set<string>();
  const ensure = async (period: string, at: string) => {
    if (created.has(period)) return;
    try {
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: emptyDay(period, at),
          ConditionExpression: "attribute_not_exists(#p)",
          ExpressionAttributeNames: { "#p": "period" },
        }),
      );
    } catch (error) {
      if (!conditionFailed(error)) throw error;
    }
    created.add(period);
  };
  return {
    add: async (period, increments, at) => {
      await ensure(period, at);
      const names: Record<string, string> = { "#updated": "updatedAt" };
      const values: Record<string, unknown> = { ":at": at };
      const adds: string[] = [];
      let index = 0;
      const placeholder = (value: number) => {
        index += 1;
        values[`:v${String(index)}`] = value;
        return `:v${String(index)}`;
      };
      for (const [name, value] of Object.entries(increments.counters ?? {})) {
        names[`#${name}`] = name;
        adds.push(`#${name} ${placeholder(value)}`);
      }
      for (const [name, entries] of Object.entries(increments.maps ?? {})) {
        names[`#${name}`] = name;
        for (const [key, value] of Object.entries(entries)) {
          index += 1;
          const keyName = `#k${String(index)}`;
          names[keyName] = key;
          adds.push(`#${name}.${keyName} ${placeholder(value)}`);
        }
      }
      if (adds.length === 0) return;
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { rollupType: "DAY", period },
          UpdateExpression: `ADD ${adds.join(", ")} SET #updated = :at`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }),
      );
    },
    setTotals: async (period, totals, at) => {
      await ensure(period, at);
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { rollupType: "DAY", period },
          ...updateExpression({ ...totals, updatedAt: at }),
        }),
      );
    },
    get: async (period) => {
      const out = (await client.send(
        new GetCommand({
          TableName: tableName,
          Key: { rollupType: "DAY", period },
          ConsistentRead: true,
        }),
      )) as { Item?: Record<string, unknown> };
      return out.Item === undefined ? null : MetricRollupSchema.parse(out.Item);
    },
    range: async (from, to) =>
      (
        await queryAll(
          client,
          (start) =>
            new QueryCommand({
              TableName: tableName,
              KeyConditionExpression: "rollupType = :t AND #p BETWEEN :from AND :to",
              ExpressionAttributeNames: { "#p": "period" },
              ExpressionAttributeValues: { ":t": "DAY", ":from": from, ":to": to },
              ExclusiveStartKey: start,
            }),
        )
      ).map((item) => MetricRollupSchema.parse(item)),
  };
}
