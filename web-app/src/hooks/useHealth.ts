import { useQuery } from "@tanstack/react-query";
import type { HealthCheck } from "../services/types";
import { useServices } from "./useServices";

export type { HealthCheck } from "../services/types";

export interface HealthState {
  result: HealthCheck | null;
  error: unknown;
  checking: boolean;
  recheck: () => void;
}

/** One health check per visit, never retried or cached, so the page shows exactly what the server answered. */
export function useHealth(): HealthState {
  const { health } = useServices();
  const query = useQuery({
    queryKey: ["health"],
    queryFn: () => health.check(),
    retry: false,
    gcTime: 0,
  });
  return {
    result: query.data ?? null,
    error: query.error,
    checking: query.isFetching,
    recheck: () => {
      void query.refetch();
    },
  };
}
