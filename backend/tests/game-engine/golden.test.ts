import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createBundledRulesRepository } from "../../src/game-catalog";
import { playLine, stateHash } from "../functional/solver";

/** Golden games (game-engine.md section 14.2, spider-solitaire.md SP-5): recorded wins replayed from their seeds. */
const GoldenSchema = z.object({
  name: z.string(),
  options: z.record(z.string(), z.union([z.string(), z.number()])),
  seed: z.string(),
  actions: z.array(z.string()),
  final: z.object({
    status: z.literal("WON"),
    score: z.number(),
    moveCount: z.number(),
    completedRuns: z.number(),
    stateHash: z.string(),
  }),
});

const dir = new URL("./golden/", import.meta.url);
const goldens = readdirSync(dir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => GoldenSchema.parse(JSON.parse(readFileSync(new URL(file, dir), "utf8"))));
const spider = createBundledRulesRepository().compiled("spider-solitaire");

describe("golden Spider games", () => {
  it("covers every suit option", () => {
    expect(goldens.map((golden) => golden.options["suits"]).sort()).toEqual([1, 2, 4]);
  });

  for (const golden of goldens) {
    it(`replays exactly: ${golden.name}`, () => {
      const start = spider.createGame({
        options: golden.options,
        seed: golden.seed,
        seats: ["S1"],
      });
      const end = playLine(spider, start, golden.actions);
      expect({
        status: end.status,
        score: end.vars["score"],
        moveCount: end.vars["moveCount"],
        completedRuns: end.vars["completedRuns"],
        stateHash: stateHash(end),
      }).toEqual(golden.final);
      expect(end.vars["score"]).toBe(500 - golden.actions.length + 800);
    });
  }
});
