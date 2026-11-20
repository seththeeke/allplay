import { defineConfig } from "vitest/config";

/** Full-size rules simulation (game-engine.md section 13); never part of the unit run. */
export default defineConfig({
  test: {
    include: ["tests/simulation/**/*.simulation.test.ts"],
    environment: "node",
    testTimeout: 900000,
  },
});
