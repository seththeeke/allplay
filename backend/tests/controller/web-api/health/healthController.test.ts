import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../../../../src/logger";
import { createHealthHandler } from "../../../../src/controller/web-api/health/healthController";
import { healthRoutes } from "../../../../src/controller/web-api/health/healthRoutes";
import { createHealthService } from "../../../../src/service/healthService";

function event(method: string, path: string): unknown {
  return { rawPath: path, requestContext: { requestId: "r-1", http: { method, path } } };
}

function setup() {
  const write = vi.fn();
  const handler = createHealthHandler({
    health: createHealthService("Test"),
    logger: createLogger({ write }),
  });
  return { handler, write };
}

describe("health controller", () => {
  it("answers GET /v1/health with 200 and the stage", async () => {
    const { handler, write } = setup();
    const result = await handler(event("GET", "/v1/health"));
    expect(result.statusCode).toBe(200);
    expect(result.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(result.body)).toEqual({ status: "OK", stage: "Test" });
    expect(String(write.mock.calls[0]?.[1])).toContain('"requestId":"r-1"');
  });

  it("answers other paths and methods with 404", async () => {
    const { handler } = setup();
    for (const request of [event("POST", "/v1/health"), event("GET", "/v1/other")]) {
      const result = await handler(request);
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body)).toEqual({ code: "NOT_FOUND", message: "No such route." });
    }
  });

  it("rejects a malformed event with 400", async () => {
    const { handler } = setup();
    const result = await handler({ rawPath: 7 });
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("declares one public route", () => {
    expect(healthRoutes).toEqual([{ method: "GET", path: "/v1/health", auth: "NONE" }]);
  });
});
