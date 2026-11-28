import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApiClient } from "../../../src/services/live/apiClient";
import { createPauseSignal } from "../../../src/services/pauseSignal";

const reply = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

describe("API client pause signal", () => {
  it("pauses on ANDON_CORD_PULLED and resumes on the next success", async () => {
    const paused = createPauseSignal();
    const fetchImpl = vi
      .fn()
      .mockReturnValueOnce(
        reply(500, { code: "ANDON_CORD_PULLED", message: "All Play is paused right now." }),
      )
      .mockReturnValueOnce(reply(500, { code: "INTERNAL_ERROR", message: "Something went wrong." }))
      .mockReturnValueOnce(reply(200, { ok: true }));
    const api = createApiClient("http://localhost:4000", fetchImpl, undefined, paused);
    await expect(api.get("v1/games", z.object({ ok: z.boolean() }))).rejects.toThrow(
      "All Play is paused right now.",
    );
    expect(paused.paused()).toBe(true);
    await expect(api.get("v1/games", z.object({ ok: z.boolean() }))).rejects.toThrow();
    expect(paused.paused()).toBe(false);
    paused.set(true);
    expect(
      await api.put("v1/admin/andon", { pulled: false }, z.object({ ok: z.boolean() })),
    ).toEqual({ ok: true });
    expect(paused.paused()).toBe(false);
    expect(fetchImpl.mock.calls[2]?.[1]).toMatchObject({ method: "PUT", body: '{"pulled":false}' });
  });
});
