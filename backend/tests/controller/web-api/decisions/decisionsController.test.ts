import { describe, expect, it, vi } from "vitest";
import { createDecisionsHandler } from "../../../../src/controller/web-api/decisions/decisionsController";
import { decisionsRoutes } from "../../../../src/controller/web-api/decisions/decisionsRoutes";
import { createInMemoryConversationMessageDao } from "../../../../src/dao/conversationMessage/inMemoryConversationMessageDao";
import { createLogger } from "../../../../src/logger";
import { createConversationService } from "../../../../src/service/conversation/conversationService";
import { loadPersonality } from "../../../../src/service/conversation/personality";
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
  it("records browser latency samples in their histograms, refusing bad reports", async () => {
    const t = setupDecider({});
    const latencies = vi.fn(() => Promise.resolve());
    const handler = createDecisionsHandler({
      decisions: t.decider,
      logger: createLogger({ write }),
      metrics: { latencies },
    });
    const report = (body: unknown) => handler(apiEvent("POST /v1/telemetry/latency", { body }));
    const recorded = await report({
      samples: [
        { kind: "TRANSCRIBE", ms: 640 },
        { kind: "POLLY", ms: 410 },
      ],
    });
    expect(recorded.statusCode).toBe(200);
    expect(JSON.parse(recorded.body)).toEqual({ recorded: 2 });
    expect(latencies).toHaveBeenCalledWith([
      { histogram: "transcribeLatency", ms: 640 },
      { histogram: "pollyLatency", ms: 410 },
    ]);
    expect((await report({ samples: [] })).statusCode).toBe(400);
    expect((await report({ samples: [{ kind: "POLLY", ms: 70_000 }] })).statusCode).toBe(400);
    const unmetered = createDecisionsHandler({
      decisions: t.decider,
      logger: createLogger({ write }),
    });
    expect(
      (
        await unmetered(
          apiEvent("POST /v1/telemetry/latency", { body: { samples: [{ kind: "POLLY", ms: 1 }] } }),
        )
      ).statusCode,
    ).toBe(200);
  });

  it("greets through the game speaker for a player in the session", async () => {
    const dao = createInMemoryConversationMessageDao();
    const conversation = createConversationService({
      dao,
      personality: loadPersonality({}),
      onError: vi.fn(),
    });
    const t = setupDecider({}, { conversation });
    const envelope = await t.sessions.start(PLAYER, { gameId: "spider-solitaire" });
    const handler = createDecisionsHandler({
      decisions: t.decider,
      logger: createLogger({ write }),
    });
    const greeted = await handler(
      apiEvent("POST /v1/conversations/{sessionId}/greeting", {
        pathParameters: { sessionId: envelope.session.sessionId },
        identity: "p1",
      }),
    );
    expect(greeted.statusCode).toBe(200);
    expect(JSON.parse(greeted.body)).toMatchObject({ kind: "GREETING" });
  });

  it("decides for the IAM caller and resolves the decision", async () => {
    const { handler, envelope } = await setup();
    const body = ask("deal", { sessionId: envelope.session.sessionId, expectedVersion: 0 });
    const decided = await handler(apiEvent("POST /v1/decisions", { body, identity: "p1" }));
    expect(decided.statusCode).toBe(200);
    const reply = JSON.parse(decided.body) as {
      decisionId: string;
      outcome: string;
      proposal: { actionId: string };
    };
    expect(reply.outcome).toBe("PROPOSED");
    const target = { sessionId: envelope.session.sessionId, actionId: reply.proposal.actionId };
    const resolved = await handler(
      apiEvent("POST /v1/decisions/{decisionId}/resolution", {
        pathParameters: { decisionId: reply.decisionId },
        body: { resolution: "CONFIRMED", ...target, expectedVersion: 0, clientLatencyMs: 10 },
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
        body: { resolution: "CONFIRMED", ...target, expectedVersion: 0, clientLatencyMs: 10 },
      }),
    );
    /* Nothing remembers the turn; the stale version is what refuses a repeat. */
    expect(again.statusCode).toBe(409);
    expect(write).toHaveBeenCalled();
  });

  it("refuses unreadable bodies, and logs a rejection without any stored turn", async () => {
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
    const rejected = await handler(
      apiEvent("POST /v1/decisions/{decisionId}/resolution", {
        pathParameters: { decisionId: "x" },
        body: {
          resolution: "REJECTED",
          sessionId: null,
          actionId: null,
          expectedVersion: null,
          clientLatencyMs: 1,
        },
      }),
    );
    expect(JSON.parse(rejected.body)).toEqual({ session: null });
    expect(decisionsRoutes).toHaveLength(4);
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
