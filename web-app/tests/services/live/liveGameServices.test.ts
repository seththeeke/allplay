import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../../src/services/errors";
import { createApiClient, type FetchLike } from "../../../src/services/live/apiClient";
import {
  createLiveDecisionService,
  createLiveGameService,
  createLiveSessionService,
} from "../../../src/services/live/liveGameServices";
import { must } from "../../must";

const ENVELOPE = {
  session: {
    sessionId: "s/1",
    gameId: "spider-solitaire",
    status: "IN_PROGRESS",
    version: 0,
    options: {},
    summary: {},
  },
  view: {
    gameId: "spider-solitaire",
    rulesVersion: 1,
    options: {},
    status: { status: "IN_PROGRESS", blocked: false, canUndo: false },
    vars: {},
    zones: [],
  },
  legalActions: [],
  metaActions: [],
  events: [],
};

function server(routes: Record<string, [number, unknown]>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, init });
    const key = `${init?.method ?? "GET"} ${url.replace("http://api.test/", "")}`;
    const [status, body] = routes[key] ?? [404, { code: "NOT_FOUND", message: "No such route." }];
    return Promise.resolve({
      ok: status < 400,
      status,
      json: () => (body === undefined ? Promise.reject(new Error("empty")) : Promise.resolve(body)),
    });
  };
  return { api: createApiClient("http://api.test", fetchImpl), calls };
}

describe("live game services", () => {
  it("calls every session route and parses the envelope", async () => {
    const { api, calls } = server({
      "GET v1/sessions/current?gameId=spider-solitaire": [200, ENVELOPE],
      "POST v1/sessions": [201, ENVELOPE],
      "POST v1/sessions/s%2F1/actions": [200, ENVELOPE],
      "POST v1/sessions/s%2F1/undo": [200, ENVELOPE],
      "GET v1/sessions/s%2F1/hint": [200, { action: null, text: "Deal." }],
      "POST v1/sessions/s%2F1/abandon": [200, ENVELOPE],
      "GET v1/games": [200, { games: [] }],
    });
    const sessions = createLiveSessionService(api);
    expect((await sessions.current("spider-solitaire"))?.session.sessionId).toBe("s/1");
    await sessions.start("spider-solitaire");
    await sessions.start("spider-solitaire", { suits: 2 });
    expect(JSON.parse(must(calls.at(-1)).init?.body as string)).toEqual({
      gameId: "spider-solitaire",
      options: { suits: 2 },
    });
    await sessions.apply("s/1", { actionId: "DEAL_ROW", expectedVersion: 0, source: "VOICE" });
    await sessions.undo("s/1", { expectedVersion: 1, source: "KEYBOARD" });
    expect(await sessions.hint("s/1")).toEqual({ action: null, text: "Deal." });
    await sessions.abandon("s/1", { expectedVersion: 2 });
    expect(await createLiveGameService(api).list()).toEqual({ games: [] });
  });

  it("maps 404 on current to null and other failures to ApiRequestError", async () => {
    const { api } = server({
      "POST v1/sessions/x/actions": [
        409,
        { code: "VERSION_CONFLICT", message: "The game changed", current: ENVELOPE },
      ],
      "GET v1/sessions/current?gameId=boom": [500, undefined],
    });
    const sessions = createLiveSessionService(api);
    expect(await sessions.current("spider-solitaire")).toBeNull();
    const conflict = await sessions
      .apply("x", { actionId: "a", expectedVersion: 0, source: "VOICE" })
      .catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(ApiRequestError);
    expect((conflict as ApiRequestError).body.current?.session.version).toBe(0);
    await expect(sessions.current("boom")).rejects.toMatchObject({
      status: 500,
      body: { code: "INTERNAL_ERROR", message: "The server answered 500." },
    });
  });

  it("decides and resolves through the decision routes", async () => {
    const reply = {
      decisionId: "d1",
      outcome: "PROPOSED",
      displayText: "Deal?",
      speech: "Deal.",
      proposal: { actionId: "DEAL_ROW", text: "Deal" },
      choices: null,
      appAction: null,
      session: null,
    };
    const { api } = server({
      "POST v1/decisions": [200, reply],
      "POST v1/decisions/d1/resolution": [200, { session: null }],
    });
    const decisions = createLiveDecisionService(api);
    expect(
      await decisions.decide({
        transcript: "deal",
        transcriptSource: "TYPED",
        context: { screen: "GAME", sessionId: "s", expectedVersion: 0, pendingPrompt: null },
      }),
    ).toEqual(reply);
    expect(
      await decisions.resolve("d1", {
        resolution: "CONFIRMED",
        sessionId: "s",
        actionId: "DEAL_ROW",
        expectedVersion: 0,
        clientLatencyMs: 4,
      }),
    ).toEqual({ session: null });
  });

  it("uses the global fetch by default", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ games: [] }))));
    vi.stubGlobal("fetch", fetchSpy);
    await createApiClient("http://api.test/").get("v1/games", {
      parse: (v: unknown) => v,
    } as never);
    expect(fetchSpy).toHaveBeenCalledWith("http://api.test/v1/games", { headers: {} });
    vi.unstubAllGlobals();
  });
});
