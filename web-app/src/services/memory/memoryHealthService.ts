import type { HealthService } from "../types";

/** Local runs have no server; the health check answers for the local stage. */
export const memoryHealthService: HealthService = {
  check: () =>
    Promise.resolve({ httpStatus: 200, body: { status: "OK", stage: "LOCAL" }, latencyMs: 0 }),
};
