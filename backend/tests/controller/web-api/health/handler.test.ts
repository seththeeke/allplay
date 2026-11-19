import { afterEach, describe, expect, it, vi } from "vitest";

describe("health Lambda entry", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reports the STAGE environment variable", async () => {
    vi.stubEnv("STAGE", "Prod");
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const { handler } = await import("../../../../src/controller/web-api/health/handler");
    const result = await handler({
      rawPath: "/v1/health",
      requestContext: { requestId: "r", http: { method: "GET", path: "/v1/health" } },
    });
    expect(JSON.parse(result.body)).toEqual({ status: "OK", stage: "Prod" });
  });

  it("falls back to UNKNOWN without a stage", async () => {
    vi.stubEnv("STAGE", undefined);
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const { handler } = await import("../../../../src/controller/web-api/health/handler");
    const result = await handler({
      rawPath: "/v1/health",
      requestContext: { requestId: "r", http: { method: "GET", path: "/v1/health" } },
    });
    expect(JSON.parse(result.body)).toMatchObject({ stage: "UNKNOWN" });
  });
});
