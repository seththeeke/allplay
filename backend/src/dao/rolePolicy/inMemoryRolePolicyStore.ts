import type { RolePolicyStore } from "./rolePolicyStore";

/** RolePolicyStore over a map keyed `<role>/<policy>`, for the local server and tests. */
export function createInMemoryRolePolicyStore(): RolePolicyStore & {
  policies: Map<string, object>;
} {
  const policies = new Map<string, object>();
  return {
    policies,
    put: (roleName, policyName, document) => {
      policies.set(`${roleName}/${policyName}`, structuredClone(document));
      return Promise.resolve();
    },
    remove: (roleName, policyName) => {
      policies.delete(`${roleName}/${policyName}`);
      return Promise.resolve();
    },
  };
}
