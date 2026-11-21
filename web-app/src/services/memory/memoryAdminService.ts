import {
  sampleDeployments,
  sampleDuplicates,
  sampleFailures,
  sampleMetrics,
} from "../../../test-data/admin";
import type { Deployment } from "../../models/api";
import type { AdminService } from "../types";

/** Admin API over deterministic sample data; a started deployment shows as in progress. */
export function createMemoryAdminService(now: () => Date = () => new Date()): AdminService {
  const started: Deployment[] = [];
  const merged = new Set<string>();
  return {
    metrics: (from, to) =>
      Promise.resolve({
        days: sampleMetrics(now()).filter((day) => day.period >= from && day.period <= to),
      }),
    failures: (day) => Promise.resolve({ decisions: sampleFailures(day) }),
    deployments: () => Promise.resolve({ deployments: [...started, ...sampleDeployments(now())] }),
    startDeployment: () => {
      const at = now().toISOString();
      const executionId = `execution-admin-${String(started.length + 1)}`;
      started.unshift({
        executionId,
        status: "IN_PROGRESS",
        trigger: "ADMIN",
        startedAt: at,
        lastUpdatedAt: at,
        stages: [{ name: "Build", status: "IN_PROGRESS" }],
      });
      return Promise.resolve({ executionId });
    },
    duplicates: () =>
      Promise.resolve({
        duplicates: sampleDuplicates()
          .map((group) => ({
            ...group,
            accounts: group.accounts.filter((account) => !merged.has(account.playerId)),
          }))
          .filter((group) => group.accounts.length > 1),
      }),
    mergeAccounts: (primaryPlayerId, duplicatePlayerId) => {
      merged.add(duplicatePlayerId);
      return Promise.resolve({ primaryPlayerId, mergedPlayerId: duplicatePlayerId });
    },
  };
}
