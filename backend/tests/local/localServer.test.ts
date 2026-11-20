import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../src/logger";
import { DEFAULT_DEV_CALLER, devCaller, toHttpApiEvent } from "../../src/local/eventAdapter";
import { createLocalProviders, type LocalProviders } from "../../src/local/providers";
import { createLocalServer, MAX_BODY_BYTES } from "../../src/local/server";
import { resolveSettings } from "../../src/local/settings";
import { fakeSpeech, silentWav } from "../service/speech/fakeSpeech";

const logger = createLogger({ write: vi.fn() });
let base = "";
let providers: LocalProviders;
const server = { close: () => undefined } as { close: () => void };

beforeAll(async () => {
  providers = await createLocalProviders(
    resolveSettings({ ALLPLAY_PRESET: "continuous-integration" }),
    {},
    {
      speechCandidates: [
        fakeSpeech("", false, "macos-speech"),
        fakeSpeech("Move 3 to 7", true, "whisper.cpp"),
      ],
      logger,
    },
  );
  const http = createLocalServer(providers);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${String((http.address() as AddressInfo).port)}`;
  server.close = () => http.close();
});
afterAll(() => {
  server.close();
});

const decide = (transcript: string, caller?: string) =>
  fetch(`${base}/v1/decisions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(caller === undefined ? {} : { "x-allplay-dev-caller": caller }),
    },
    body: JSON.stringify({
      transcript,
      transcriptSource: "TYPED",
      context: { screen: "HOME", sessionId: null, expectedVersion: null, pendingDecisionId: null },
    }),
  });

describe("local server", () => {
  it("serves the health route through the Lambda handler, with CORS for the web origin", async () => {
    const response = await fetch(`${base}/v1/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "OK", stage: "LOCAL" });
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const preflight = await fetch(`${base}/v1/decisions`, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toContain("x-allplay-dev-caller");
  });

  it("reports the preset and each capability", async () => {
    const body = (await (await fetch(`${base}/local/status`)).json()) as {
      preset: string;
      capabilities: Record<string, { provider: string; available: boolean }>;
    };
    expect(body.preset).toBe("continuous-integration");
    expect(body.capabilities["speechIn"]).toMatchObject({
      provider: "whisper.cpp",
      available: true,
    });
    expect(body.capabilities["llm"]).toMatchObject({ available: false });
    expect(body.capabilities["storage"]).toMatchObject({ provider: "in-memory", available: true });
  });

  it("transcribes WAV audio and refuses anything else", async () => {
    const ok = await fetch(`${base}/local/speech/transcribe`, {
      method: "POST",
      body: silentWav(),
    });
    expect(await ok.json()).toMatchObject({
      text: "Move 3 to 7",
      transcriptSource: "WHISPER",
      provider: "whisper.cpp",
    });
    const bad = await fetch(`${base}/local/speech/transcribe`, { method: "POST", body: "hello" });
    expect(bad.status).toBe(400);
    const huge = await fetch(`${base}/local/speech/transcribe`, {
      method: "POST",
      body: new Uint8Array(MAX_BODY_BYTES + 10),
    }).catch(() => null);
    expect(huge === null || huge.status === 413).toBe(true);
  });

  it("records decisions per development caller, lists them newest first, and resets", async () => {
    expect((await decide("deal")).status).toBe(200);
    expect((await decide("hint")).status).toBe(200);
    expect((await decide("undo", "someone-else")).status).toBe(200);
    const listed = (await (await fetch(`${base}/local/decisions`)).json()) as {
      decisions: { transcript: string; playerId: string }[];
    };
    expect(listed.decisions.map((d) => d.transcript)).toEqual(["hint", "deal"]);
    expect(listed.decisions[0]?.playerId).toBe("GUEST#local-guest");
    expect((await fetch(`${base}/local/reset`, { method: "POST" })).status).toBe(200);
    expect(await (await fetch(`${base}/local/decisions`)).json()).toEqual({ decisions: [] });
  });

  it("answers unknown routes with 404 and handler failures with 500", async () => {
    expect((await fetch(`${base}/v1/nope`)).status).toBe(404);
    const original = providers.handlers.health;
    const broken = vi
      .spyOn(providers, "handlers", "get")
      .mockReturnValue({ health: () => Promise.reject(new Error("boom")), decisions: original });
    const failed = await fetch(`${base}/v1/health`);
    expect(failed.status).toBe(500);
    broken.mockRestore();
  });

  it("reports unavailable speech with 503", async () => {
    const typed = await createLocalProviders(
      resolveSettings({ ALLPLAY_PRESET: "continuous-integration" }),
      {},
      { logger },
    );
    const http = createLocalServer(typed);
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const port = (http.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${String(port)}/local/speech/transcribe`, {
      method: "POST",
      body: silentWav(),
    });
    expect(response.status).toBe(503);
    http.close();
  });
});

describe("event adapter", () => {
  it("builds a payload 2.0 event with the development caller as the IAM identity", () => {
    const event = toHttpApiEvent(
      {
        method: "POST",
        path: "/v1/decisions",
        query: "a=1",
        headers: { "x-allplay-dev-caller": "pat", accept: ["a", "b"] as unknown as string },
        body: Buffer.from("{}"),
      },
      () => "req-1",
    );
    expect(event).toMatchObject({
      version: "2.0",
      routeKey: "POST /v1/decisions",
      rawQueryString: "a=1",
      body: Buffer.from("{}").toString("base64"),
      isBase64Encoded: true,
      headers: { accept: "a,b" },
      requestContext: {
        requestId: "req-1",
        authorizer: { iam: { cognitoIdentity: { identityId: "pat" } } },
      },
    });
    expect(
      toHttpApiEvent({
        method: "GET",
        path: "/",
        query: "",
        headers: { x: undefined },
        body: Buffer.alloc(0),
      }),
    ).not.toHaveProperty("body");
    expect(devCaller({ "x-allplay-dev-caller": "bad caller!" })).toBe(DEFAULT_DEV_CALLER);
    expect(devCaller({})).toBe(DEFAULT_DEV_CALLER);
  });
});
