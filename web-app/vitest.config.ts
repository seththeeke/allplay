import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ["tests/**/*.test.{ts,tsx}"],
      exclude: ["tests/smoke/**", "node_modules/**"],
      environment: "jsdom",
      setupFiles: ["tests/setup.ts"],
      coverage: {
        provider: "v8",
        include: ["src/**/*.{ts,tsx}"],
        reporter: ["text", "html", "json-summary"],
        thresholds: { lines: 95, branches: 95, functions: 95, statements: 95 },
      },
    },
  }),
);
