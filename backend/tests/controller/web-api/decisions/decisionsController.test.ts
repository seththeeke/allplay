import { describe, expect, it, vi } from "vitest";
import { createDecisionsHandler } from "../../../../src/controller/web-api/decisions/decisionsController";
import { decisionsRoutes } from "../../../../src/controller/web-api/decisions/decisionsRoutes";
import { createLogger } from "../../../../src/logger";
import {
  ask,
  FIRST_MOVE,
  heard,
  numberOf,
  PLAYER,
  setupDecider,
} from "../../../service/decision/decider";
import { apiEvent } from "../apiEvent";

const write = vi.fn();

async function setup() {
  const texts = new Map<string, string>();
  const t = setupDecider({
    classify: (request) =>
      heard(request) === "deal"
        ? { category: "GAME", response: null, optionNumber: null }
        : { category: "UNRECOGNIZED", response: null, optionNumber: null },
    select_actions: (request) => ({
      selected: [numberOf(request, FIRST_MOVE, texts)],
      confidence: "HIGH",
    }),
  });
  const envelope = await t.sessions.start(PLAYER, { gameId: "spider-solitaire" });
  for (const action of envelope.legalActions) texts.set(action.actionId, action.text);
  const handler = createDecisionsHandler({ decisions: t.decider, logger: createLogger({ write }) });
  return { handler, envelope };
}

describe("decisions controller", () => {
  it("decides for the IAM caller and resolves the decision", async () => {
    const { handler, envelope } = await setup();
    const body = ask("deal", { sessionId: envelope.session.sessionId, expectedVersion: 0 });
    const decided = await handler(apiEvent("POST /v1/decisions", { body, identity: "p1" }));
    expect(decided.statusCode).toBe(200);
    const reply = JSON.parse(decided.body) as { decisionId: string; outcome: string };
    expect(reply.outcome).toBe("PROPOSED");
    const resolved = await handler(
      apiEvent("POST /v1/decisions/{decisionId}/resolution", {
        pathParameters: { decisionId: reply.decisionId },
        body: {
          resolution: "CONFIRMED",
          optionNumber: null,
          expectedVersion: 0,
          clientLatencyMs: 10,
        },
      }),
    );
    expect(resolved.statusCode).toBe(200);
    expect(
      (JSON.parse(resolved.body) as { session: { session: { version: number } } }).session.session
        .version,
    ).toBe(1);
    const again = await handler(
      apiEvent("POST /v1/decisions/{decisionId}/resolution", {
        pathParameters: { decisionId: reply.decisionId },
        body: {
          resolution: "CONFIRMED",
          optionNumber: null,
          expectedVersion: 1,
          clientLatencyMs: 10,
        },
      }),
    );
    expect(again.statusCode).toBe(422);
    expect(write).toHaveBeenCalled();
  });

  it("refuses unreadable bodies and unknown decisions", async () => {
    const { handler } = await setup();
    expect(
      (await handler(apiEvent("POST /v1/decisions", { body: { transcript: "" } }))).statusCode,
    ).toBe(400);
    expect(
      (
        await handler(
          apiEvent("POST /v1/decisions/{decisionId}/resolution", {
            pathParameters: { decisionId: "x" },
            body: {},
          }),
        )
      ).statusCode,
    ).toBe(400);
    const missing = await handler(
      apiEvent("POST /v1/decisions/{decisionId}/resolution", {
        pathParameters: { decisionId: "x" },
        body: {
          resolution: "REJECTED",
          optionNumber: null,
          expectedVersion: null,
          clientLatencyMs: 1,
        },
      }),
    );
    expect(missing.statusCode).toBe(404);
    expect(decisionsRoutes).toHaveLength(2);
  });
});

describe("request bodies", () => {
  it("reads base64 bodies and treats non-JSON as missing", async () => {
    const { handler } = await setup();
    const body = Buffer.from(JSON.stringify(ask("hello", { screen: "HOME" }))).toString("base64");
    const event = { ...apiEvent("POST /v1/decisions"), body, isBase64Encoded: true };
    expect((await handler(event)).statusCode).toBe(200);
    expect((await handler(apiEvent("POST /v1/decisions", { body: "{not json" }))).statusCode).toBe(
      400,
    );
  });
});
