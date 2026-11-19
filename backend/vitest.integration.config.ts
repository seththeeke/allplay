import { defineConfig } from "vitest/config";

/** API integration tests against a deployed stage (cdk-stacks.md section 7); never part of the unit run. */
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.integration.test.ts"],
    environment: "node",
    testTimeout: 15000,
  },
});
