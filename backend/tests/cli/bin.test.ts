import { afterEach, describe, expect, it, vi } from "vitest";

const lines: string[] = [];
const close = vi.fn();

vi.mock("node:readline", () => ({
  createInterface: () => ({
    [Symbol.asyncIterator]: () => ({
      next: () => {
        const value = lines.shift();
        return Promise.resolve(
          value === undefined ? { done: true, value: undefined } : { done: false, value },
        );
      },
    }),
    close,
  }),
}));

describe("game-engine-cli entry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("runs the command line from process.argv and sets the exit code", async () => {
    const written: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((text) => {
      written.push(String(text));
      return true;
    });
    const argv = process.argv;
    process.argv = ["node", "game-engine-cli", "--help"];
    try {
      await import("../../src/cli/bin");
      await vi.waitFor(() => {
        expect(process.exitCode).toBe(0);
      });
    } finally {
      process.argv = argv;
      process.exitCode = undefined;
    }
    expect(written.join("")).toContain("Usage: game-engine-cli");
  });

  it("reads typed lines until quit, then closes the terminal", async () => {
    const written: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((text) => {
      written.push(String(text));
      return true;
    });
    lines.push("board", "quit");
    const argv = process.argv;
    process.argv = ["node", "game-engine-cli", "--help"];
    const { main } = await import("../../src/cli/bin");
    process.argv = argv;
    expect(await main(["start", "--spider"])).toBe(0);
    expect(await main(["start", "--spider"])).toBe(0);
    expect(written.join("")).toContain("spider> ");
    expect(written.join("")).toContain("Goodbye.");
    expect(close).toHaveBeenCalled();
    process.exitCode = undefined;
  });
});
