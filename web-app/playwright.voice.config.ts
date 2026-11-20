import { defineConfig, devices } from "@playwright/test";

/*
 * The voice playthrough (local-development.md section 6): runs against a local
 * stack that is already up (backend `npm run dev:server` with the Claude API,
 * web `npm run dev`). It spends Claude API credits, so it never runs in CI.
 */
export default defineConfig({
  testDir: "tests/voice-playthrough",
  timeout: 60 * 60 * 1000,
  use: { baseURL: process.env["VOICE_BASE_URL"] ?? "http://localhost:5173" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  reporter: [["list"]],
});
