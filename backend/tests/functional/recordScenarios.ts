/*
 * Regenerates recorded lines: npx tsx tests/functional/recordScenarios.ts
 * Run it only when the Spider rules change. It overwrites the one-suit
 * functional scenario and the golden games; the four-suit search takes
 * about a minute and a half.
 */
import { writeFileSync } from "node:fs";
import { createBundledRulesRepository } from "../../src/game-catalog";
import type { GameState } from "../../src/game-engine";
import { followHints, searchByDeals, searchForWin, stateHash, type SolverResult } from "./solver";

const game = createBundledRulesRepository().compiled("spider-solitaire");

function write(path: string, value: unknown): void {
  writeFileSync(new URL(path, import.meta.url), `${JSON.stringify(value, null, 2)}\n`);
}

function record(
  file: string,
  name: string,
  options: { suits: number; dealStyle: string },
  seed: string,
  solve: (start: GameState) => SolverResult | null,
): void {
  const result = solve(game.createGame({ options, seed, seats: ["S1"] }));
  if (result?.state.status !== "WON") throw new Error(`${name}: seed ${seed} was not won`);
  const golden = {
    name,
    options,
    seed,
    actions: result.actions,
    final: {
      status: result.state.status,
      score: result.state.vars["score"],
      moveCount: result.state.vars["moveCount"],
      completedRuns: result.state.vars["completedRuns"],
      stateHash: stateHash(result.state),
    },
  };
  write(`../game-engine/golden/${file}`, golden);
  process.stdout.write(`${file}: ${String(result.actions.length)} actions\n`);
}

const oneSuitSeed = "00000000000000000000000000000001";
const oneSuit = followHints(
  game,
  game.createGame({ options: { suits: 1 }, seed: oneSuitSeed, seats: ["S1"] }),
);
write("./scenarios/spider-win-one-suit.json", {
  name: "Following the hints wins a one-suit game",
  options: { suits: 1, dealStyle: "MICROSOFT" },
  seed: oneSuitSeed,
  actions: oneSuit.actions,
});
record(
  "spider-one-suit.json",
  "One suit, won by following hints",
  { suits: 1, dealStyle: "MICROSOFT" },
  oneSuitSeed,
  (start) => followHints(game, start),
);
record(
  "spider-two-suits.json",
  "Two suits, won by depth-first search",
  { suits: 2, dealStyle: "MICROSOFT" },
  "00000000000000000000000000000201",
  (start) => searchForWin(game, start, 20000),
);
record(
  "spider-four-suits.json",
  "Four suits, won by deal-phase search",
  { suits: 4, dealStyle: "MICROSOFT" },
  "00000000000000000000000000000401",
  (start) => searchByDeals(game, start, { phaseLimit: 3000 }),
);
