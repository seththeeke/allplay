import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

/**
 * Local integration run (local-development.md section 6, LD-5): starts the
 * local server with the continuous-integration preset, waits until it
 * answers, runs the integration suite against it, and stops it.
 */
const PORT = process.env["PORT"] ?? "4100";
const base = `http://localhost:${PORT}/`;
const server = spawn("npx", ["tsx", "src/local/start.ts"], {
  env: { ...process.env, ALLPLAY_PRESET: "continuous-integration", PORT },
  stdio: ["ignore", "ignore", "inherit"],
});

async function ready(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(new URL("local/status", base))).ok) return;
    } catch {
      /* Not listening yet. */
    }
    await wait(500);
  }
  throw new Error("The local server did not start.");
}

let code = 1;
try {
  await ready();
  code = await new Promise<number>((resolve) => {
    spawn(
      "npx",
      ["vitest", "run", "--config", "vitest.integration.config.ts", "--reporter=verbose"],
      {
        env: {
          ...process.env,
          API_URL: base,
          INTEGRATION_TARGET: "local",
          INTEGRATION_SCOPE: "stage",
          EXPECTED_STAGE: "LOCAL",
        },
        stdio: "inherit",
      },
    ).on("exit", (exit) => {
      resolve(exit ?? 1);
    });
  });
} finally {
  server.kill();
}
process.exit(code);
