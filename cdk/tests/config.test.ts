import { describe, expect, it } from "vitest";
import { isProd, resourceName, stackName, STAGE_NAMES } from "../lib/config";

describe("config", () => {
  it("names resources with the project and stage", () => {
    expect(resourceName("Players", "Test")).toBe("AllPlay-Players-Test");
    expect(resourceName("GameSessions", "Prod")).toBe("AllPlay-GameSessions-Prod");
  });

  it("rejects base names that would produce malformed physical names", () => {
    expect(() => resourceName("game-sessions", "Test")).toThrow(/PascalCase/);
    expect(() => resourceName("", "Test")).toThrow(/PascalCase/);
  });

  it("names stacks per stage", () => {
    expect(stackName("Stateful", "Test")).toBe("AllPlayStateful-Test");
    expect(stackName("App", "Prod")).toBe("AllPlayApp-Prod");
  });

  it("knows which stage is Prod", () => {
    expect(STAGE_NAMES).toEqual(["Test", "Prod"]);
    expect(isProd("Prod")).toBe(true);
    expect(isProd("Test")).toBe(false);
  });
});
