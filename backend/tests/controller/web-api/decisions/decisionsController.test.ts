import { describe, expect, it, vi } from "vitest";
import { createDecisionsHandler } from "../../../../src/controller/web-api/decisions/decisionsController";
import { decisionsRoutes } from "../../../../src/controller/web-api/decisions/decisionsRoutes";
import { jsonBody } from "../../../../src/controller/web-api/shared/httpEvent";
import { resolveCaller } from "../../../../src/controller/web-api/shared/resolveCaller";
import { createInMemoryDecisionDao } from "../../../../src/dao/decision/inMemoryDecisionDao";
import { createLogger } from "../../../../src/logger";
import { createDecisionService } from "../../../../src/service/decision/decisionService";

const BODY = {
  transcript: "deal",
  transcriptSource: "TYPED",
  context: { screen: "HOME", sessionId: null, expectedVersion: null, pendingDecisionId: null },
};

function event(options: {
  body?: unknown;
  identity?: string | null;
  method?: string;
  path?: string;
  base64?: boolean;
}) {
  const body =
    options.body === undefined
      ? undefined
      : typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body);
  return {
    rawPath: options.path ?? "/v1/decisions",
    ...(body === undefined
      ? {}
      : {
          body: options.base64 === true ? Buffer.from(body).toString("base64") : body,
          isBase64Encoded: options.base64 === true,
        }),
    requestContext: {
      requestId: "r1",
      http: { method: options.method ?? "POST", path: options.path ?? "/v1/decisions" },
      ...(options.identity === null
        ? {}
        : { authorizer: { iam: { cognitoIdentity: { identityId: options.identity ?? "id-1" } } } }),
    },
  };
}

const handler = createDecisionsHandler({
  decisions: createDecisionService({ dao: createInMemoryDecisionDao() }),
  logger: createLogger({ write: vi.fn() }),
});

describe("decisions controller", () => {
  it("records a decision for the IAM caller, from JSON or base64 bodies", async () => {
    for (const base64 of [false, true]) {
      const result = await handler(event({ body: BODY, base64 }));
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toMatchObject({
        outcome: "UNRECOGNIZED",
        speech: "I heard deal.",
      });
    }
  });

  it("rejects malformed events, other routes, missing callers and bad bodies", async () => {
    expect((await handler({})).statusCode).toBe(400);
    expect((await handler(event({ body: BODY, method: "GET" }))).statusCode).toBe(404);
    expect((await handler(event({ body: BODY, identity: null }))).statusCode).toBe(401);
    expect((await handler(event({ body: "not json" }))).statusCode).toBe(400);
    expect((await handler(event({}))).statusCode).toBe(400);
    expect(
      (await handler(event({ body: { ...BODY, transcriptSource: "GUESS" } }))).statusCode,
    ).toBe(400);
  });

  it("declares the route list and helpers", () => {
    expect(decisionsRoutes).toEqual([
      { method: "POST", path: "/v1/decisions", auth: "IAM", minimumTier: "GUEST" },
    ]);
    expect(resolveCaller(event({ identity: null }) as never)).toBeNull();
    expect(
      jsonBody({
        rawPath: "/",
        requestContext: { requestId: "r", http: { method: "GET", path: "/" } },
      }),
    ).toBeUndefined();
  });
});
