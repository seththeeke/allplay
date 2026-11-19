import { HealthResponseSchema } from "../../models/api";
import type { HealthService } from "../types";

type FetchLike = (input: string) => Promise<Pick<Response, "status" | "json">>;

/** Calls the stage's public `GET /v1/health` at the API's default URL. Network failures reject. */
export function createLiveHealthService(
  apiUrl: string,
  fetchImpl: FetchLike = (input) => fetch(input, { cache: "no-store" }),
  now: () => number = () => performance.now(),
): HealthService {
  const url = new URL("v1/health", apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`).toString();
  return {
    check: async () => {
      const started = now();
      const response = await fetchImpl(url);
      const parsed = HealthResponseSchema.safeParse(await response.json().catch(() => null));
      return {
        httpStatus: response.status,
        body: parsed.success ? parsed.data : null,
        latencyMs: Math.round(now() - started),
      };
    },
  };
}
