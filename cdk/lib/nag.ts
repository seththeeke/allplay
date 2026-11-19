import { Validations } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import type { IConstruct } from "constructs";

/**
 * Acknowledges every AwsSolutions finding under `scope` whose id starts with
 * `prefix`, for constructs whose resources CDK generates with ids that cannot
 * be named ahead of time (CDK Pipelines). Returns the acknowledged ids so tests
 * can check that nothing outside the intended rule was acknowledged.
 */
export function acknowledgeGenerated(scope: IConstruct, prefix: string, reason: string): string[] {
  const ids = new AwsSolutionsChecks()
    .validateScope(scope)
    .violations.map((violation) => violation.ruleName)
    .filter((id) => id.startsWith(prefix));
  for (const id of ids) {
    Validations.of(scope).acknowledge({ id, reason });
  }
  return ids;
}
