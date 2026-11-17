import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      include: ["bin/**/*.ts", "lib/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      thresholds: { lines: 95, branches: 95, functions: 95, statements: 95 },
    },
  },
});
