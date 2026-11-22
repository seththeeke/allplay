import { describe, expect, it } from "vitest";
import { createLogsInsightsTurnLogReader } from "../../../src/dao/turnLog/logsInsightsTurnLogReader";

/** A stub CloudWatch Logs client answering each command with the next reply. */
function stub(...replies: unknown[]) {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  return {
    sent,
    send: (command: object) => {
      const { input } = command as { input: Record<string, unknown> };
      sent.push({ name: command.constructor.name, input });
      return Promise.resolve(replies.shift() ?? {});
    },
  };
}

const row = (fields: Record<string, string>) =>
  Object.entries(fields).map(([field, value]) => ({ field, value }));

describe("Logs Insights turn log reader", () => {
  it("queries one UTC day of the log group and polls until the query completes", async () => {
    const api = stub(
      { queryId: "q1" },
      { status: "Running" },
      {
        status: "Complete",
        results: [
          row({
            "@timestamp": "2026-11-21 09:00:00.000",
            event: "TURN_DECIDED",
            decisionId: "d1",
            gameId: "spider-solitaire",
            transcript: "deal",
            outcome: "PROPOSED",
          }),
          row({
            "@timestamp": "2026-11-21 09:00:02.000",
            event: "TURN_RESOLVED",
            decisionId: "d1",
            outcome: "CONFIRMED",
            failureClass: "NONE",
            clientLatencyMs: "1200",
          }),
          row({ event: "OTHER", decisionId: "x" }),
          row({ event: "TURN_DECIDED" }),
          [{}],
        ],
      },
    );
    const reader = createLogsInsightsTurnLogReader("/aws/lambda/AllPlay-DecisionApi-Test", api, {
      sleep: () => Promise.resolve(),
    });
    const events = await reader.day("2026-11-21");
    expect(api.sent[0]).toMatchObject({
      name: "StartQueryCommand",
      input: {
        logGroupName: "/aws/lambda/AllPlay-DecisionApi-Test",
        startTime: Date.parse("2026-11-21T00:00:00.000Z") / 1000,
        endTime: Date.parse("2026-11-21T23:59:59.000Z") / 1000,
      },
    });
    expect(api.sent.slice(1).map((sent) => sent.input)).toEqual([
      { queryId: "q1" },
      { queryId: "q1" },
    ]);
    expect(events).toEqual([
      {
        event: "TURN_DECIDED",
        decisionId: "d1",
        timestamp: "2026-11-21 09:00:00.000",
        gameId: "spider-solitaire",
        transcript: "deal",
        outcome: "PROPOSED",
        failureClass: undefined,
        clientLatencyMs: undefined,
      },
      {
        event: "TURN_RESOLVED",
        decisionId: "d1",
        timestamp: "2026-11-21 09:00:02.000",
        gameId: undefined,
        transcript: undefined,
        outcome: "CONFIRMED",
        failureClass: "NONE",
        clientLatencyMs: 1200,
      },
    ]);
  });

  it("fails a query that ends otherwise or runs past its wait, and reads empty results", async () => {
    const quick = { sleep: () => Promise.resolve(), waitMs: 0 };
    await expect(
      createLogsInsightsTurnLogReader("g", stub({ queryId: "q" }, { status: "Failed" }), quick).day(
        "2026-11-21",
      ),
    ).rejects.toThrow("ended Failed");
    await expect(
      createLogsInsightsTurnLogReader(
        "g",
        stub({ queryId: "q" }, { status: "Scheduled" }),
        quick,
      ).day("2026-11-21"),
    ).rejects.toThrow("took too long");
    expect(
      await createLogsInsightsTurnLogReader("g", stub({}, { status: "Complete" }), quick).day(
        "2026-11-21",
      ),
    ).toEqual([]);
    expect(typeof createLogsInsightsTurnLogReader("g").day).toBe("function");
  });

  it("waits between polls with its own timer by default", async () => {
    const reader = createLogsInsightsTurnLogReader(
      "g",
      stub({ queryId: "q" }, { status: "Running" }, { status: "Complete", results: [] }),
      { pollMs: 1 },
    );
    expect(await reader.day("2026-11-21")).toEqual([]);
  });
});
