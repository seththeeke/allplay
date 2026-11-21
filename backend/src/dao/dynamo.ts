import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/** The part of the DynamoDB document client the DAOs use, so unit tests can stub it. */
export interface DocumentSender {
  send(command: object): Promise<unknown>;
}

/** The document client with the default credential chain; undefined values are dropped, as optional fields are. */
export function documentClient(): DocumentSender {
  return DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
}

/** True when a write's condition failed. */
export const conditionFailed = (error: unknown): boolean =>
  error instanceof Error && error.name === "ConditionalCheckFailedException";

/**
 * `SET a = :a, ...` with every name behind a placeholder (`ttl` and other
 * attribute names are DynamoDB reserved words).
 */
export function updateExpression(
  set: Readonly<Record<string, unknown>>,
  remove: readonly string[] = [],
  setIfAbsent: Readonly<Record<string, unknown>> = {},
): {
  UpdateExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, unknown>;
} {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  let index = 0;
  const placeholder = (field: string, value: unknown): [string, string] => {
    index += 1;
    names[`#f${String(index)}`] = field;
    values[`:v${String(index)}`] = value;
    return [`#f${String(index)}`, `:v${String(index)}`];
  };
  for (const [field, value] of Object.entries(set)) {
    if (value === undefined) continue;
    const [name, val] = placeholder(field, value);
    sets.push(`${name} = ${val}`);
  }
  for (const [field, value] of Object.entries(setIfAbsent)) {
    const [name, val] = placeholder(field, value);
    sets.push(`${name} = if_not_exists(${name}, ${val})`);
  }
  const removes = remove.map((field) => {
    index += 1;
    names[`#f${String(index)}`] = field;
    return `#f${String(index)}`;
  });
  return {
    UpdateExpression: [
      sets.length > 0 ? `SET ${sets.join(", ")}` : "",
      removes.length > 0 ? `REMOVE ${removes.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" "),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}
