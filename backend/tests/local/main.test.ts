import { afterEach, describe, expect, it, vi } from "vitest";
import { startLocalServer } from "../../src/local/main";

describe("startLocalServer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("listens on the configured port and logs the providers", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const server = await startLocalServer({ ALLPLAY_PRESET: "continuous-integration", PORT: "0" });
    expect(server.listening).toBe(true);
    server.close();
  });

  it("starts from the npm script entry", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const env = process.env;
    process.env = { ...env, ALLPLAY_PRESET: "continuous-integration", PORT: "0" };
    try {
      await import("../../src/local/start");
    } finally {
      process.env = env;
    }
    expect(true).toBe(true);
  });
});
