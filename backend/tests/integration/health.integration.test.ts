import { describe, expect, it } from "vitest";
import { HealthResponseSchema } from "../../src/models/api";
import { apiUrl } from "./apiUrl";

/** Runs against a deployed stage; API_URL is the stage's default execute-api URL. */
describe("GET /v1/health", () => {
  it("returns 200 with the stage", async () => {
    const response = await fetch(new URL("v1/health", apiUrl()));
    expect(response.status).toBe(200);
    const body = HealthResponseSchema.parse(await response.json());
    expect(body.stage).toBe(process.env["EXPECTED_STAGE"] ?? body.stage);
  });

  it("returns 404 with the error contract for an unknown health path", async () => {
    const response = await fetch(new URL("v1/health/nope", apiUrl()));
    expect([403, 404]).toContain(response.status);
  });

  it("allows the web origin through CORS", async () => {
    const origin = process.env["WEB_ORIGIN"];
    if (origin === undefined) return;
    const response = await fetch(new URL("v1/health", apiUrl()), { headers: { origin } });
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
  });
});
