import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../../../src/logger";
import {
  createDeployedDecisionService,
  deployedLanguageModel,
} from "../../../src/service/decision/deployedDecider";

describe("deployed decider", () => {
  it("uses Bedrock, behind fixed test answers only when Test enables them", () => {
    const logger = createLogger({ write: vi.fn() });
    expect(deployedLanguageModel({}, logger).name).toBe("bedrock");
    expect(deployedLanguageModel({ DECIDER_FIXED_RESPONSES: "ENABLED" }, logger).name).toBe(
      "fixed+bedrock",
    );
    expect(typeof createDeployedDecisionService(logger, {}).decide).toBe("function");
  });

  it("builds the DecisionApi handler", async () => {
    const { handler } = await import("../../../src/controller/web-api/decisions/handler");
    expect(typeof handler).toBe("function");
  });
});
