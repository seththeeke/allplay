import {
  DeploymentsResponseSchema,
  DuplicateAccountsResponseSchema,
  MergeResponseSchema,
  StartDeploymentResponseSchema,
} from "../../models/api";
import type { AdminService } from "../types";
import type { ApiClient } from "./apiClient";

/** The admin API through an API client (the local server). Metrics and failures stay empty until their routes land (AA-8). */
export function createLiveAdminService(api: ApiClient): AdminService {
  return {
    metrics: () => Promise.resolve({ days: [] }),
    failures: () => Promise.resolve({ decisions: [] }),
    deployments: () => api.get("v1/admin/deployments", DeploymentsResponseSchema),
    startDeployment: () => api.post("v1/admin/deployments", {}, StartDeploymentResponseSchema),
    duplicates: () => api.get("v1/admin/players/duplicates", DuplicateAccountsResponseSchema),
    mergeAccounts: (primaryPlayerId, duplicatePlayerId) =>
      api.post(
        "v1/admin/players/merge",
        { primaryPlayerId, duplicatePlayerId },
        MergeResponseSchema,
      ),
  };
}
