import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../src/logger";
import { DEFAULT_DEV_CALLER, devCaller, toHttpApiEvent } from "../../src/local/eventAdapter";
import { createLocalProviders, type LocalProviders } from "../../src/local/providers";
import { createLocalServer, matchRoute, MAX_BODY_BYTES } from "../../src/local/server";
import { resolveSettings } from "../../src/local/settings";
import { createFakeLlm } from "../../src/service/decision/llm/fakeLlm";
import { createUnavailableTts } from "../../src/service/speech/textToSpeech";
import { numberOf } from "../service/decision/decider";
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
    expect(body.capabilities["llm"]).toMatchObject({ provider: "fake", available: true });
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

  it("serves the session routes with path parameters, and deals a fixed seed", async () => {
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const seed = "00000000000000000000000000000001";
    expect((await post("/local/seed", { seed: "xyz" })).status).toBe(400);
    expect((await post("/local/seed", { seed })).status).toBe(200);
    const first = (await (await post("/v1/sessions", { gameId: "spider-solitaire" })).json()) as {
      session: { sessionId: string };
      view: unknown;
      legalActions: { actionId: string }[];
    };
    const again = (await (await post("/v1/sessions", { gameId: "spider-solitaire" })).json()) as {
      view: unknown;
    };
    expect(again.view).toEqual(first.view);
    const current = await fetch(`${base}/v1/sessions/current?gameId=spider-solitaire`);
    expect(current.status).toBe(200);
    const id = encodeURIComponent(first.session.sessionId);
    expect((await fetch(`${base}/v1/sessions/${id}`)).status).toBe(200);
    expect((await fetch(`${base}/v1/sessions/${id}/hint`)).status).toBe(200);
    expect(
      (
        await fetch(`${base}/v1/sessions/current?gameId=spider-solitaire`, {
          headers: { "x-allplay-dev-caller": "someone-else" },
        })
      ).status,
    ).toBe(404);
    expect((await post("/local/seed", { seed: null })).status).toBe(200);
    const random = (await (await post("/v1/sessions", { gameId: "spider-solitaire" })).json()) as {
      view: unknown;
    };
    expect(random.view).not.toEqual(first.view);
    expect((await fetch(`${base}/local/seed`, { method: "POST", body: "not json" })).status).toBe(
      400,
    );
  });

  it("prefers literal routes over parameters when matching", () => {
    const route = (template: string) => ({
      method: "GET",
      template,
      segments: template.split("/"),
      handler: () => Promise.reject(new Error("unused")),
    });
    const routes = [route("/v1/sessions/{sessionId}"), route("/v1/sessions/current")];
    expect(matchRoute(routes, "GET", "/v1/sessions/current")?.route.template).toBe(
      "/v1/sessions/current",
    );
    expect(matchRoute(routes, "GET", "/v1/sessions/abc")?.pathParameters).toEqual({
      sessionId: "abc",
    });
    expect(matchRoute(routes, "GET", "/v1/sessions/")).toBeNull();
    expect(matchRoute(routes, "POST", "/v1/sessions/abc")).toBeNull();
    expect(matchRoute(routes, "GET", "/v1/other/abc")).toBeNull();
  });

  it("answers unknown routes with 404 and handler failures with 500", async () => {
    expect((await fetch(`${base}/v1/nope`)).status).toBe(404);
    const original = providers.handlers.health;
    const broken = vi.spyOn(providers, "handlers", "get").mockReturnValue({
      health: () => Promise.reject(new Error("boom")),
      decisions: original,
      game: original,
    });
    const failed = await fetch(`${base}/v1/health`);
    expect(failed.status).toBe(500);
    broken.mockRestore();
  });

  it("speaks through the text to speech provider and lists what the recorder heard", async () => {
    const post = (body: unknown) =>
      fetch(`${base}/local/speech/synthesize`, {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
    const spoken = await post({ text: "Move nine to six.", rate: 1.2 });
    expect(spoken.status).toBe(200);
    expect(spoken.headers.get("content-type")).toBe("audio/wav");
    expect(String.fromCharCode(...new Uint8Array(await spoken.arrayBuffer()).slice(0, 4))).toBe(
      "RIFF",
    );
    expect((await post({ text: "Default rate." })).status).toBe(200);
    for (const bad of [
      { text: "" },
      { text: "x".repeat(601) },
      { text: "x", rate: 3 },
      { text: "x", rate: "fast" },
      "nope",
    ])
      expect((await post(bad)).status).toBe(400);
    expect(await (await fetch(`${base}/local/speech/spoken`)).json()).toEqual({
      spoken: ["Move nine to six.", "Default rate."],
    });
  });

  it("answers 503 when speech output is not set up, and lists nothing spoken", async () => {
    const off = await createLocalProviders(
      resolveSettings({ ALLPLAY_PRESET: "continuous-integration" }),
      {},
      { logger, textToSpeech: createUnavailableTts("kokoro", "Run setup.") },
    );
    const http = createLocalServer(off);
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${String((http.address() as AddressInfo).port)}`;
    const response = await fetch(`${url}/local/speech/synthesize`, {
      method: "POST",
      body: JSON.stringify({ text: "hello" }),
    });
    expect(response.status).toBe(503);
    expect(await (await fetch(`${url}/local/speech/spoken`)).json()).toEqual({ spoken: [] });
    const failing = await createLocalProviders(
      resolveSettings({ ALLPLAY_PRESET: "continuous-integration" }),
      {},
      {
        logger,
        textToSpeech: {
          name: "broken",
          status: () => Promise.resolve({ available: true, detail: "" }),
          synthesize: () => Promise.reject(new Error("bug")),
        },
      },
    );
    const broken = createLocalServer(failing);
    await new Promise<void>((resolve) => broken.listen(0, "127.0.0.1", resolve));
    const brokenUrl = `http://127.0.0.1:${String((broken.address() as AddressInfo).port)}`;
    expect(
      (
        await fetch(`${brokenUrl}/local/speech/synthesize`, {
          method: "POST",
          body: '{"text":"x"}',
        })
      ).status,
    ).toBe(500);
    broken.close();
    http.close();
  });

  it("chooses the language model per setting", async () => {
    const status = async (env: Record<string, string>) =>
      (await (await createLocalProviders(resolveSettings(env), env, { logger })).status())["llm"];
    expect(
      await status({
        ALLPLAY_LLM: "claude-code",
        ALLPLAY_CLAUDE_BIN: "definitely-not-claude-allplay",
      }),
    ).toMatchObject({ provider: "claude-code", available: false });
    const speechOut = async (env: Record<string, string>) =>
      (await (await createLocalProviders(resolveSettings(env), env, { logger })).status())[
        "speechOut"
      ];
    expect(await speechOut({ ALLPLAY_SPEECH_OUT: "polly" })).toMatchObject({
      provider: "polly",
      available: false,
    });
    expect(
      await speechOut({ ALLPLAY_SPEECH_OUT: "kokoro", ALLPLAY_KOKORO_VOICE: "am_adam" }),
    ).toMatchObject({
      provider: "kokoro",
    });
    expect(await status({ ALLPLAY_LLM: "bedrock" })).toMatchObject({
      provider: "bedrock",
      available: false,
    });
    expect(
      await status({
        ALLPLAY_LLM: "claude-api",
        ANTHROPIC_API_KEY: "test-key",
        ALLPLAY_CLAUDE_MODEL: "m",
      }),
    ).toMatchObject({ provider: "claude-api", available: true, detail: "Claude API, model m." });
  });

  it("plays a voice turn end to end: decide, then resolve", async () => {
    const texts = new Map<string, string>();
    const scripted = await createLocalProviders(
      resolveSettings({ ALLPLAY_PRESET: "continuous-integration" }),
      {},
      {
        logger,
        newSeed: () => "00000000000000000000000000000001",
        llm: createFakeLlm((request) =>
          request.tool.name === "classify"
            ? { category: "GAME", response: null, optionNumber: null }
            : {
                selected: [
                  numberOf(request, "MOVE_UNIT|from=tableau.1|depth=1|to=tableau.6", texts),
                ],
                confidence: "HIGH",
              },
        ),
      },
    );
    const http = createLocalServer(scripted);
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${String((http.address() as AddressInfo).port)}`;
    const post = async (path: string, body: unknown) =>
      (await fetch(`${url}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json())) as Record<string, unknown> & { decisionId: string };
    const envelope = (await post("/v1/sessions", { gameId: "spider-solitaire" })) as unknown as {
      session: { sessionId: string };
      legalActions: { actionId: string; text: string }[];
    };
    for (const action of envelope.legalActions) texts.set(action.actionId, action.text);
    const decided = await post("/v1/decisions", {
      transcript: "one to six",
      transcriptSource: "TYPED",
      context: {
        screen: "GAME",
        sessionId: envelope.session.sessionId,
        expectedVersion: 0,
        pendingDecisionId: null,
      },
    });
    expect(decided["outcome"]).toBe("PROPOSED");
    const resolved = await post(`/v1/decisions/${decided.decisionId}/resolution`, {
      resolution: "CONFIRMED",
      optionNumber: null,
      expectedVersion: 0,
      clientLatencyMs: 5,
    });
    expect(resolved).toMatchObject({ session: { session: { version: 1 } } });
    http.close();
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
      queryStringParameters: { a: "1" },
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
