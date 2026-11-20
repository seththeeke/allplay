import { describe, expect, it } from "vitest";
import { createBundledRulesRepository } from "../../src/game-catalog";
import { validateRules } from "../../src/game-engine";

/**
 * Stage 3 rules validation at the spec's full size (game-engine.md section 13:
 * 50 seeds per option combination, 500 actions each, random undos) for every
 * bundled game. Run by `npm run test:simulation` in CI; too slow for the unit run.
 */
describe("bundled rules simulation", () => {
  const repository = createBundledRulesRepository();
  it("passes for every bundled game and option combination", async () => {
    for (const entry of await repository.list()) {
      const result = validateRules(await repository.latest(entry.gameId), { simulate: {} });
      expect(result.valid ? [] : result.issues).toEqual([]);
    }
  });
});
