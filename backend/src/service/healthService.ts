import type { HealthResponse } from "../models/api";

export interface HealthService {
  check(): HealthResponse;
}

/** Reports the stage as healthy. It reads no data, so a 200 proves the route, Lambda and API are wired. */
export function createHealthService(stage: string): HealthService {
  return { check: () => ({ status: "OK", stage }) };
}
