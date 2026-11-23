import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadPersonality,
  parsePersonality,
  personalityPath,
} from "../../../src/service/conversation/personality";

const SOURCE = join("src", "service", "conversation", "personality", "game-speaker.md");

describe("game speaker personality", () => {
  it("loads every section of the shipped file", () => {
    const personality = loadPersonality({});
    expect(personality.persona).toContain("game speaker");
    expect(personality.greeting).toBe("Game's started. Let me know what you'd like to do.");
    expect(personality.acknowledgements).toContain("All set.");
    expect(personality.confirm).toContain("{action}");
    expect(personality.choices).toContain("{options}");
  });

  it("refuses a file with a missing section or template slot", () => {
    const file = readFileSync(SOURCE, "utf8");
    expect(() => parsePersonality(file.replace("## Greeting", "## Hello"))).toThrow();
    expect(() => parsePersonality(file.replace("{action}", "that"))).toThrow();
    expect(() => parsePersonality(file.replace(/^- .*$/gm, ""))).toThrow();
    expect(() => parsePersonality("")).toThrow();
  });

  it("finds the file beside the Lambda bundle, in the backend, or from the repository root", () => {
    expect(personalityPath({ LAMBDA_TASK_ROOT: "/var/task" })).toBe("/var/task/game-speaker.md");
    expect(personalityPath({}, "/repo/backend", () => true)).toBe(join("/repo/backend", SOURCE));
    expect(personalityPath({}, "/repo", () => false)).toBe(join("/repo", "backend", SOURCE));
  });
});
