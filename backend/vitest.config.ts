import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: [
      "tests/emulator/**",
      "tests/integration/**",
      "tests/simulation/**",
      "node_modules/**",
    ],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      thresholds: { lines: 95, branches: 95, functions: 95, statements: 95 },
    },
  },
});
