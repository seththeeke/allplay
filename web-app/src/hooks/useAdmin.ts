import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdminDecision,
  DayMetrics,
  Deployment,
  DuplicateAccountsResponse,
} from "../models/api";
import { useServices } from "./useServices";

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface UseAdmin {
  days: DayMetrics[];
  failures: AdminDecision[];
  deployments: Deployment[];
  deploy: () => Promise<void>;
  duplicates: DuplicateAccountsResponse["duplicates"];
  mergeAccounts: (primaryPlayerId: string, duplicatePlayerId: string) => Promise<void>;
}

/** Admin data for the last 30 days (authn-authz.md section 5). */
export function useAdmin(today: Date = new Date()): UseAdmin {
  const { admin } = useServices();
  const queryClient = useQueryClient();
  const to = isoDay(today);
  const start = new Date(today);
  start.setUTCDate(today.getUTCDate() - 29);
  const from = isoDay(start);
  const metrics = useQuery({
    queryKey: ["admin", "metrics", from, to],
    queryFn: () => admin.metrics(from, to),
  });
  const failures = useQuery({
    queryKey: ["admin", "failures", to],
    queryFn: () => admin.failures(to),
  });
  const deployments = useQuery({
    queryKey: ["admin", "deployments"],
    queryFn: () => admin.deployments(),
  });
  const duplicates = useQuery({
    queryKey: ["admin", "duplicates"],
    queryFn: () => admin.duplicates(),
  });
  const merge = useMutation({
    mutationFn: ([primary, duplicate]: [string, string]) => admin.mergeAccounts(primary, duplicate),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "duplicates"] }),
  });
  const deploy = useMutation({
    mutationFn: () => admin.startDeployment(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "deployments"] }),
  });
  return {
    days: metrics.data?.days ?? [],
    failures: failures.data?.decisions ?? [],
    deployments: deployments.data?.deployments ?? [],
    deploy: async () => {
      await deploy.mutateAsync();
    },
    duplicates: duplicates.data?.duplicates ?? [],
    mergeAccounts: async (primary, duplicate) => {
      await merge.mutateAsync([primary, duplicate]);
    },
  };
}
