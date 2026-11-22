import { describe, expect, it, vi } from "vitest";
import { createLiveVoiceLabService } from "../../../src/services/live/liveVoiceLabService";

function respond(status: number, body: unknown) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => (body === undefined ? Promise.reject(new Error("no body")) : Promise.resolve(body)),
  });
}

describe("live Voice Lab service", () => {
  it("calls the local server routes and parses their contracts", async () => {
    const fetchImpl = vi.fn((url: string) => {
      if (url.endsWith("local/status")) return respond(200, { preset: "local", capabilities: {} });
      if (url.endsWith("local/speech/transcribe"))
        return respond(200, {
          text: "deal",
          transcriptSource: "MACOS_SPEECH",
          provider: "macos-speech",
          latencyMs: 5,
        });
      if (url.endsWith("local/decisions")) {
        return respond(200, {
          decisions: [
            {
              decisionId: "d1",
              playerId: "GUEST#x",
              transcript: "deal",
              transcriptSource: "TYPED",
              uiContext: { screen: "HOME", pendingDecisionId: null },
              outcome: "UNRECOGNIZED",
              createdAt: "2026-11-20T12:00:00.000Z",
            },
          ],
        });
      }
      return respond(200, {
        decisionId: "d1",
        outcome: "UNRECOGNIZED",
        displayText: "I heard deal.",
        speech: "I heard deal.",
        proposal: null,
        choices: null,
        appAction: null,
        session: null,
      });
    });
    const service = createLiveVoiceLabService("http://localhost:4000", fetchImpl);
    expect(await service.status()).toEqual({ preset: "local", capabilities: {} });
    expect((await service.transcribe(new Uint8Array([1]))).text).toBe("deal");
    expect((await service.send("deal", "TYPED")).outcome).toBe("UNRECOGNIZED");
    expect(await service.recent()).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/v1/decisions",
      expect.objectContaining({ method: "POST" }),
    );
    const sent = JSON.parse(
      (fetchImpl.mock.calls[2] as unknown as [string, RequestInit])[1].body as string,
    ) as { transcript: string; transcriptSource: string };
    expect(sent).toMatchObject({ transcript: "deal", transcriptSource: "TYPED" });
  });

  it("rejects with the server's message, or its status", async () => {
    const failing = createLiveVoiceLabService("http://localhost:4000/", () =>
      respond(503, { message: "Helper not built." }),
    );
    await expect(failing.transcribe(new Uint8Array([1]))).rejects.toThrow("Helper not built.");
    const silent = createLiveVoiceLabService("http://localhost:4000/", () =>
      respond(500, undefined),
    );
    await expect(silent.status()).rejects.toThrow("The local server answered 500.");
  });

  it("uses the browser fetch by default", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ preset: "local", capabilities: {} }))),
    );
    vi.stubGlobal("fetch", fetchSpy);
    expect((await createLiveVoiceLabService("http://localhost:4000/").status()).preset).toBe(
      "local",
    );
    vi.unstubAllGlobals();
  });
});
