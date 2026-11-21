import { describe, expect, it } from "vitest";
import { runId, writesAllowed } from "./integration/stage";

describe("integration test scope", () => {
  it("allows writes only when the pipeline marks the Test stage", () => {
    expect(writesAllowed({ INTEGRATION_SCOPE: "stage" })).toBe(true);
    expect(writesAllowed({ INTEGRATION_SCOPE: "readonly" })).toBe(false);
    expect(writesAllowed({})).toBe(false);
  });

  it("names each run after its CodeBuild build, or randomly", () => {
    expect(runId({ CODEBUILD_BUILD_ID: "AllPlay-Verify:1234-abcd" })).toBe("itest-1234-abcd");
    expect(runId({})).toMatch(/^itest-[0-9a-f]{12}$/);
  });
});
