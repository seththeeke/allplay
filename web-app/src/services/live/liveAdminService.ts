import {
  AdminDecisionsResponseSchema,
  AndonStateSchema,
  DeploymentsResponseSchema,
  MetricsResponseSchema,
  DuplicateAccountsResponseSchema,
  MergeResponseSchema,
  StartDeploymentResponseSchema,
} from "../../models/api";
import type { AdminService } from "../types";
import type { ApiClient } from "./apiClient";

/** The admin API through an API client (the local server). */
export function createLiveAdminService(api: ApiClient): AdminService {
  return {
    metrics: (from, to) =>
      api.get(
        `v1/admin/metrics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        MetricsResponseSchema,
      ),
    failures: (day) =>
      api.get(`v1/admin/decisions?day=${encodeURIComponent(day)}`, AdminDecisionsResponseSchema),
    deployments: () => api.get("v1/admin/deployments", DeploymentsResponseSchema),
    startDeployment: () => api.post("v1/admin/deployments", {}, StartDeploymentResponseSchema),
    duplicates: () => api.get("v1/admin/players/duplicates", DuplicateAccountsResponseSchema),
    mergeAccounts: (primaryPlayerId, duplicatePlayerId) =>
      api.post(
        "v1/admin/players/merge",
        { primaryPlayerId, duplicatePlayerId },
        MergeResponseSchema,
      ),
    andon: () => api.get("v1/admin/andon", AndonStateSchema),
    setAndon: (pulled) => api.put("v1/admin/andon", { pulled }, AndonStateSchema),
  };
}
