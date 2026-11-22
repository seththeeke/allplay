import { randomBytes } from "node:crypto";
import { afterAll, describe } from "vitest";

/**
 * Integration test scope (cdk-stacks.md section 7). The pipeline sets
 * INTEGRATION_SCOPE to `stage` for Test, where tests may write data, and to
 * `readonly` for Prod. A run with no scope set is read-only.
 */
export function writesAllowed(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env["INTEGRATION_SCOPE"] === "stage";
}

/** True when the suite runs against the local server (local-development.md section 6), not a stage. */
export function localTarget(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env["INTEGRATION_TARGET"] === "local";
}

/** `describe` for tests that create data; they are skipped outside the Test stage and the local server. */
export const describeWrites = describe.runIf(writesAllowed());

/** `describe` for tests of the stage's own tables, which the local server does not have. */
export const describeTables = describe.runIf(writesAllowed() && !localTarget());

/** One id per test run, from the CodeBuild build when there is one, so test data never collides. */
export function runId(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const build = env["CODEBUILD_BUILD_ID"]?.split(":").at(-1);
  return `itest-${(build ?? randomBytes(6).toString("hex")).slice(0, 36)}`;
}

/**
 * Registers clean-up for data a test created; every registered step runs after
 * the file's tests, in reverse order, and one failing step does not stop the others.
 */
export function cleanUp(step: () => Promise<unknown>): void {
  afterAll(async () => {
    try {
      await step();
    } catch (error) {
      process.stderr.write(`Integration clean-up failed: ${String(error)}\n`);
    }
  });
}
