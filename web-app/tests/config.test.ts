import { describe, expect, it, vi } from "vitest";
import { ConfigLoadError, loadConfig } from "../src/config";

function respond(body: unknown, ok = true, status = 200) {
  return (input: string) => {
    expect(input).toBe("/config.json");
    return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
  };
}

describe("loadConfig", () => {
  it("returns a valid local configuration", async () => {
    await expect(loadConfig(respond({ stage: "LOCAL", dataMode: "MEMORY" }))).resolves.toEqual({
      stage: "LOCAL",
      dataMode: "MEMORY",
    });
  });

  it("returns a valid live configuration", async () => {
    const live = {
      stage: "TEST",
      dataMode: "LIVE",
      region: "us-east-1",
      apiUrl: "https://abc123.execute-api.us-east-1.amazonaws.com",
      userPoolId: "us-east-1_example",
      userPoolClientId: "client",
      identityPoolId: "us-east-1:pool",
      oauthDomain: "allplay-test-000000000000.auth.us-east-1.amazoncognito.com",
      transcribeVocabularyName: "allplay-vocabulary-test",
    };
    await expect(loadConfig(respond(live))).resolves.toEqual(live);
  });

  it("rejects a failed request", async () => {
    await expect(loadConfig(respond({}, false, 404))).rejects.toThrow(
      new ConfigLoadError("config.json request failed with status 404"),
    );
  });

  it("rejects an invalid document", async () => {
    await expect(loadConfig(respond({ stage: "DEV", dataMode: "MEMORY" }))).rejects.toBeInstanceOf(
      ConfigLoadError,
    );
  });

  it("uses the global fetch by default", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ stage: "LOCAL", dataMode: "MEMORY" }))),
      ),
    );
    try {
      await expect(loadConfig()).resolves.toEqual({ stage: "LOCAL", dataMode: "MEMORY" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
