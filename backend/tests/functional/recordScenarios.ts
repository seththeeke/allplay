/*
 * Regenerates the recorded winning line: npx tsx tests/functional/recordScenarios.ts
 * Run it only when the Spider rules change; it overwrites scenarios/spider-win-one-suit.json.
 */
import { writeFileSync } from "node:fs";
import { createBundledRulesRepository } from "../../src/game-catalog";
import { followHints } from "./solver";

const SEED = "00000000000000000000000000000001";
const game = createBundledRulesRepository().compiled("spider-solitaire");
const start = game.createGame({ options: { suits: 1 }, seed: SEED, seats: ["S1"] });
const { actions, state } = followHints(game, start);
if (state.status !== "WON") throw new Error(`Seed ${SEED} did not win by hints`);
const scenario = {
  name: "Following the hints wins a one-suit game",
  options: { suits: 1, dealStyle: "MICROSOFT" },
  seed: SEED,
  actions,
};
writeFileSync(
  new URL("./scenarios/spider-win-one-suit.json", import.meta.url),
  `${JSON.stringify(scenario, null, 2)}\n`,
);
process.stdout.write(
  `recorded ${String(actions.length)} actions, score ${String(state.vars["score"])}\n`,
);
