import { defineConfig, devices } from "@playwright/test";

/* Smoke tests run against SMOKE_BASE_URL (a deployed stage) or the local dev server. */
const baseURL = process.env["SMOKE_BASE_URL"] ?? "http://localhost:5173";

export default defineConfig({
  testDir: "tests/smoke",
  use: { baseURL },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(process.env["SMOKE_BASE_URL"] === undefined
    ? { webServer: { command: "npm run dev", url: baseURL, reuseExistingServer: true } }
    : {}),
});
