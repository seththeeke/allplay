import type { DocumentSender } from "../../src/dao/dynamo";

/** A command the stub received: its class name and input. */
export interface Sent {
  command: string;
  input: Record<string, unknown>;
}

/** A DocumentSender that answers each command with the next queued reply (an output or an Error). */
export function stubDynamo(...replies: (object | Error)[]): DocumentSender & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    send: (command: object) => {
      const { input } = command as { input: Record<string, unknown> };
      sent.push({ command: command.constructor.name, input });
      const reply = replies.shift() ?? {};
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    },
  };
}

/** The error DynamoDB returns when a condition expression fails. */
export function conditionalCheckFailed(): Error {
  const error = new Error("The conditional request failed");
  error.name = "ConditionalCheckFailedException";
  return error;
}

/** The error DynamoDB returns when a transaction is cancelled, with one reason code per item. */
export function cancelled(codes: string[]): Error {
  const error = new Error("Transaction cancelled") as Error & {
    CancellationReasons: { Code: string }[];
  };
  error.name = "TransactionCanceledException";
  error.CancellationReasons = codes.map((Code) => ({ Code }));
  return error;
}
