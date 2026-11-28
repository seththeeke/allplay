import { DeleteRolePolicyCommand, IAMClient, PutRolePolicyCommand } from "@aws-sdk/client-iam";

/**
 * Inline policies on the Identity Pool roles (productionalization.md section
 * 4.2). A DAO-layer adapter, so services never import the IAM client.
 */
export interface RolePolicyStore {
  put(roleName: string, policyName: string, document: object): Promise<void>;
  /** Removes the policy; a policy that is already gone is not an error. */
  remove(roleName: string, policyName: string): Promise<void>;
}

/** The part of the IAM client the adapter uses, so tests can stand in for it. */
export interface IamSender {
  send(command: object): Promise<unknown>;
}

/** The store over IAM; IAM is a global service, reached through us-east-1. */
export function createIamRolePolicyStore(
  client: IamSender = new IAMClient({ region: "us-east-1" }),
): RolePolicyStore {
  return {
    put: async (roleName, policyName, document) => {
      await client.send(
        new PutRolePolicyCommand({
          RoleName: roleName,
          PolicyName: policyName,
          PolicyDocument: JSON.stringify(document),
        }),
      );
    },
    remove: async (roleName, policyName) => {
      try {
        await client.send(
          new DeleteRolePolicyCommand({ RoleName: roleName, PolicyName: policyName }),
        );
      } catch (error) {
        if (error instanceof Error && error.name === "NoSuchEntityException") return;
        throw error;
      }
    },
  };
}
