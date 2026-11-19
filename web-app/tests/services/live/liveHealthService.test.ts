import { describe, expect, it, vi } from "vitest";
import { createLiveHealthService } from "../../../src/services/live/liveHealthService";

const clock = () => {
  let t = 100;
  return () => (t += 25);
};

describe("live health service", () => {
  it("calls /v1/health under the API URL and parses the body", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ status: "OK", stage: "Test" }),
      }),
    );
    const service = createLiveHealthService("https://api.example.com", fetchImpl, clock());
    await expect(service.check()).resolves.toEqual({
      httpStatus: 200,
      body: { status: "OK", stage: "Test" },
      latencyMs: 25,
    });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.example.com/v1/health");
  });

  it("keeps a trailing slash and reports bodies that break the contract as null", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve({ status: 503, json: () => Promise.reject(new Error("not json")) }),
    );
    const service = createLiveHealthService("https://api.example.com/", fetchImpl, clock());
    await expect(service.check()).resolves.toMatchObject({ httpStatus: 503, body: null });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.example.com/v1/health");
  });

  it("uses the browser fetch without caching by default", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ status: "OK", stage: "Prod" }))),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const result = await createLiveHealthService("https://api.example.com").check();
    expect(result.body).toEqual({ status: "OK", stage: "Prod" });
    expect(fetchSpy).toHaveBeenCalledWith("https://api.example.com/v1/health", {
      cache: "no-store",
    });
    vi.unstubAllGlobals();
  });
});
