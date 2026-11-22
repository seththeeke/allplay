import {
  CloudWatchLogsClient,
  GetQueryResultsCommand,
  StartQueryCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import type { LoggedTurnEvent, TurnLogReader } from "./turnLogReader";

/** The part of the CloudWatch Logs client the reader uses, so tests can stub it. */
export interface LogsQueryApi {
  send(command: object): Promise<unknown>;
}

const QUERY = [
  "fields @timestamp, event, decisionId, gameId, transcript, outcome, failureClass, clientLatencyMs",
  'filter event = "TURN_DECIDED" or event = "TURN_RESOLVED"',
  "sort @timestamp asc",
  "limit 10000",
].join(" | ");

type Row = { field?: string; value?: string }[];

/** A row of query results as an event; rows without an event or decision id are skipped. */
function toEvent(row: Row): LoggedTurnEvent | null {
  const fields = Object.fromEntries(row.map((cell) => [cell.field ?? "", cell.value ?? ""]));
  const event = fields["event"];
  const decisionId = fields["decisionId"];
  if ((event !== "TURN_DECIDED" && event !== "TURN_RESOLVED") || !decisionId) return null;
  const latency = fields["clientLatencyMs"];
  return {
    event,
    decisionId,
    timestamp: fields["@timestamp"] ?? "",
    gameId: fields["gameId"] || undefined,
    transcript: fields["transcript"] || undefined,
    outcome: fields["outcome"] ?? "",
    failureClass: fields["failureClass"] || undefined,
    clientLatencyMs: latency ? Number(latency) : undefined,
  };
}

/**
 * Reads the turn log with a CloudWatch Logs Insights query over one UTC day
 * of the DecisionApi log group (action-decision.md section 9.1). Queries run
 * asynchronously, so results are polled until complete or `waitMs` passes.
 */
export function createLogsInsightsTurnLogReader(
  logGroupName: string,
  api: LogsQueryApi = new CloudWatchLogsClient({}),
  options: { waitMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): TurnLogReader {
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return {
    day: async (day) => {
      const start = Date.parse(`${day}T00:00:00.000Z`) / 1000;
      const { queryId } = (await api.send(
        new StartQueryCommand({
          logGroupName,
          startTime: start,
          endTime: start + 24 * 60 * 60 - 1,
          queryString: QUERY,
          limit: 10000,
        }),
      )) as { queryId?: string };
      const deadline = options.waitMs ?? 8000;
      for (let waited = 0; ; waited += options.pollMs ?? 400) {
        const out = (await api.send(new GetQueryResultsCommand({ queryId }))) as {
          status?: string;
          results?: Row[];
        };
        if (out.status === "Complete")
          return (out.results ?? []).flatMap((row) => toEvent(row) ?? []);
        if (out.status !== "Running" && out.status !== "Scheduled")
          throw new Error(`The turn log query ended ${String(out.status)}.`);
        if (waited >= deadline) throw new Error("The turn log query took too long.");
        await sleep(options.pollMs ?? 400);
      }
    },
  };
}
