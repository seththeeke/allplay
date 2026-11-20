import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/cli/args";
import { cardLabel } from "../../src/cli/board";
import { SEED, script } from "./script";

const golden = JSON.parse(
  readFileSync(new URL("../game-engine/golden/spider-one-suit.json", import.meta.url), "utf8"),
) as { seed: string; actions: string[] };
const start = ["start", "--spider", "--seed", SEED];

describe("game-engine-cli arguments", () => {
  it("parses start, seeds, help and mistakes", () => {
    expect(parseArgs([])).toEqual({ command: "help" });
    expect(parseArgs(["start", "--spider", "-h"])).toEqual({ command: "help" });
    expect(parseArgs(["start", "--spider"])).toEqual({ command: "start" });
    expect(parseArgs(start)).toEqual({ command: "start", seed: SEED });
    expect(parseArgs(["play"])).toMatchObject({
      command: "error",
      message: "Unknown command: play",
    });
    expect(parseArgs(["start"])).toMatchObject({ message: "Choose a game: --spider" });
    expect(parseArgs(["start", "--spider", "--seed"])).toMatchObject({ command: "error" });
    expect(parseArgs(["start", "--spider", "--seed", "XYZ"])).toMatchObject({ command: "error" });
  });

  it("prints usage, or an error with usage and exit code 1", async () => {
    expect(await script(["--help"], [])).toEqual({
      output: expect.stringContaining("Usage: game-engine-cli start --spider") as string,
      code: 0,
    });
    const failed = await script(["start"], []);
    expect(failed.code).toBe(1);
    expect(failed.output).toMatch(/^Choose a game: --spider\n\nUsage/);
  });
});

describe("game-engine-cli session", () => {
  it("starts a one-suit game and shows the board with hidden cards", async () => {
    const { output, code } = await script(start, ["board", "", "q"]);
    expect(code).toBe(0);
    expect(output).toContain("New one-suit Spider Solitaire game.");
    expect(output).toContain("Score 500   Moves 0   Completed runs 0/8");
    expect(output).toContain("   1    2    3    4    5    6    7    8    9   10");
    expect(output).toContain("  --   --   --   --   AS  10S   KS   QS   2S   6S");
    expect(output).toContain("Stock: 50 cards, 5 deals left");
    expect(output.endsWith("Goodbye.\n")).toBe(true);
  });

  it("lists moves, plays by number, by columns and by id, deals, hints and undoes", async () => {
    const { output } = await script(start, [
      "moves",
      "hint",
      "1",
      "move 3 2",
      "move MOVE_UNIT|from=tableau.4|depth=1|to=tableau.8",
      "deal",
      "u",
      "help",
      "quit",
    ]);
    expect(output).toContain("  1. Move nine of spades from column 1 to column 6");
    expect(output).toContain("Hint: Move nine of spades from column 1 to column 6 (move 1)");
    expect(output).toContain("> Move nine of spades from column 1 to column 6\n");
    expect(output).toContain("> Move jack of spades from column 3 to column 2");
    expect(output).toContain("> Move jack of spades from column 4 to column 8");
    expect(output).toContain("> Deal a new row of cards");
    expect(output).toContain("> Undo");
    expect(output).toContain("  undo, u             undo the last action");
  });

  it("explains input it cannot play and changes nothing", async () => {
    const { output } = await script(start, [
      "foo",
      "99",
      "3 7",
      "move x y",
      "move NOPE",
      "undo",
      "q",
    ]);
    expect(output).toContain("Unknown command: foo. Type help for the list.");
    expect(output).toContain("There is no move 99. Type moves to see the list.");
    expect(output).toContain("No legal move from column 3 to column 7.");
    expect(output).toContain("Give two column numbers, for example 3 7.");
    expect(output).toContain("NOPE is not a legal move now.");
    expect(output).toContain("Nothing to undo");
    expect(output).not.toMatch(/^> /m);
  });

  it("plays a whole game to a win, then starts a new one", async () => {
    const lines = golden.actions.map((actionId) => `move ${actionId}`);
    const { output } = await script(start, [...lines, "hint", "new", "q"]);
    expect(output).toContain("Completed a run of spades");
    expect(output).toContain("You won. Final score 1192");
    expect(output).toContain("You won. Type new to play again or quit to exit.");
    expect(output).toContain("There are no moves left. Try undo or a new game.");
    expect(output.match(/New one-suit Spider Solitaire game\./g)).toHaveLength(2);
  });

  it("announces a dead end and an abandoned game", async () => {
    const seed = "000000000000000000000000000000d9";
    const deals = ["d", "d", "d", "d", "d"];
    const queue = [...deals, "moves", "hint", "new", "q"];
    const { output } = await script(["start", "--spider", "--seed", seed], queue);
    expect(output).toContain("No moves left. Type undo, new or quit.");
    expect(output).toContain("No legal moves.");
    expect(output).toContain("There are no moves left. Try undo or a new game.");
  });

  it("ends quietly when input ends", async () => {
    expect((await script(start, [])).code).toBe(0);
  });

  it("labels cards by rank and suit letter", () => {
    expect(
      cardLabel({ faceUp: true, cardId: "c1", suit: "HEARTS", rank: 10, name: "ten of hearts" }),
    ).toBe("10H");
    expect(cardLabel({ faceUp: false })).toBe("--");
  });
});
