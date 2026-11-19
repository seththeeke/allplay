import { describe, expect, it } from "vitest";
import { HealthResponseSchema } from "../../src/models/api";
import { createHealthService } from "../../src/service/healthService";

describe("health service", () => {
  it("reports OK for its stage, matching the contract", () => {
    const body = createHealthService("Test").check();
    expect(HealthResponseSchema.parse(body)).toEqual({ status: "OK", stage: "Test" });
  });
});
