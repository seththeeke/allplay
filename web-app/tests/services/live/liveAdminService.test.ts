import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../../../src/services/live/apiClient";
import { createLiveAdminService } from "../../../src/services/live/liveAdminService";

const DEPLOYMENT = {
  executionId: "e-1",
  status: "SUCCEEDED",
  trigger: "SCHEDULE",
  startedAt: "2026-11-21T10:00:00.000Z",
  lastUpdatedAt: "2026-11-21T10:20:00.000Z",
  stages: [{ name: "Source", status: "SUCCEEDED" }],
};

describe("live admin service", () => {
  it("lists and starts deployments through the API, with empty metrics", async () => {
    const fetchImpl = vi.fn((input: string, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            init?.method === "POST" ? { executionId: "e-2" } : { deployments: [DEPLOYMENT], input },
          ),
      }),
    );
    const admin = createLiveAdminService(createApiClient("http://localhost:4000", fetchImpl));
    expect((await admin.deployments()).deployments).toEqual([DEPLOYMENT]);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://localhost:4000/v1/admin/deployments");
    expect(await admin.startDeployment()).toEqual({ executionId: "e-2" });
    expect(await admin.metrics("2026-11-01", "2026-11-21")).toEqual({ days: [] });
    expect(await admin.failures("2026-11-21")).toEqual({ decisions: [] });
  });
});
