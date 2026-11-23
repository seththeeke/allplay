import { writeFileSync } from "node:fs";
import { createBundledRulesRepository } from "../../src/game-catalog";
import type { LegalAction } from "../../src/game-engine";
import { EvalSetSchema, type EvalCase } from "./cases";

/*
 * Builds the Spider Solitaire evaluation set (action-decision.md section 12)
 * from seeded boards: column commands with digits, number words and common
 * mistranscriptions, card-name commands, dealing, undo and hints, application
 * commands, answers to pending prompts, filler words and nonsense. Expected
 * actions come from the engine, so the set stays correct as rules evolve.
 * Run with `npx tsx tests/decision-eval/buildCases.ts`.
 */
const game = createBundledRulesRepository().compiled("spider-solitaire");
const WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];
const MISHEARD: Record<number, string> = { 1: "won", 2: "too", 4: "for", 8: "ate" };
const SEEDS = Array.from({ length: 10 }, (_, index) => (index + 1).toString(16).padStart(32, "0"));

const cases: EvalCase[] = [];
const add = (base: Omit<EvalCase, "id" | "gameId" | "options" | "pending"> & Partial<EvalCase>) => {
  cases.push({
    id: `spider-${String(cases.length + 1).padStart(3, "0")}`,
    gameId: "spider-solitaire",
    options: { suits: 1 },
    pending: null,
    ...base,
  });
};

/** A short history: up to `depth` moves that are not deals, so boards differ. */
function position(seed: string, depth: number): { history: string[]; actions: LegalAction[] } {
  let state = game.createGame({ options: { suits: 1 }, seed, seats: ["S1"] });
  const history: string[] = [];
  for (let step = 0; step < depth; step += 1) {
    const next = game
      .listLegalActions(state, "S1")
      .find((action) => action.descriptor.kind === "MOVE_CARDS");
    if (next === undefined) break;
    state = game.applyAction(state, "S1", next.actionId).state;
    history.push(next.actionId);
  }
  return { history, actions: game.listLegalActions(state, "S1") };
}

const column = (action: LegalAction, end: "from" | "to") => {
  const zone = (action.descriptor as { from?: { index?: number }; to?: { index?: number } })[end];
  return zone?.index ?? 0;
};

for (const [seedIndex, seed] of SEEDS.entries()) {
  const { history, actions } = position(seed, seedIndex % 4);
  const moves = actions.filter((action) => action.descriptor.kind === "MOVE_CARDS");
  for (const move of moves.slice(0, 3)) {
    const from = column(move, "from");
    const to = column(move, "to");
    const same = moves.filter(
      (other) => column(other, "from") === from && column(other, "to") === to,
    );
    const accept = same.map((other) => other.actionId);
    const ambiguous = same.length > 1;
    const game_ = { kind: "GAME" as const, accept, ambiguous };
    add({ seed, history, transcript: `${String(from)} to ${String(to)}`, expect: game_ });
    add({
      seed,
      history,
      transcript: `move column ${WORDS[from] ?? ""} to column ${WORDS[to] ?? ""}`,
      expect: game_,
    });
    add({
      seed,
      history,
      transcript: `um, move ${WORDS[from] ?? ""} over to ${WORDS[to] ?? ""} please`,
      expect: game_,
    });
    const misheardFrom = MISHEARD[from];
    const misheardTo = MISHEARD[to];
    if (misheardFrom !== undefined || misheardTo !== undefined)
      add({
        seed,
        history,
        transcript: `${misheardFrom ?? WORDS[from] ?? ""} to ${misheardTo ?? WORDS[to] ?? ""}`,
        expect: game_,
      });
    const descriptor = move.descriptor as {
      cards?: { name: string }[];
      to?: { topCard?: { name: string } };
    };
    const card = descriptor.cards?.[0]?.name;
    const target = descriptor.to?.topCard?.name;
    if (card !== undefined && target !== undefined) {
      const byName = moves.filter((other) => {
        const d = other.descriptor as typeof descriptor;
        return d.cards?.[0]?.name === card && d.to?.topCard?.name === target;
      });
      add({
        seed,
        history,
        transcript: `put the ${card} on the ${target}`,
        expect: {
          kind: "GAME",
          accept: byName.map((a) => a.actionId),
          ambiguous: byName.length > 1,
        },
      });
    }
  }
  const deal = actions.find((action) => action.descriptor.kind === "DEAL");
  if (deal !== undefined)
    for (const words of ["deal", "deal a new row", "deal the cards"])
      add({
        seed,
        history,
        transcript: words,
        expect: { kind: "GAME", accept: [deal.actionId], ambiguous: false },
      });
  for (const words of ["give me a hint", "hint please"])
    add({
      seed,
      history,
      transcript: words,
      expect: { kind: "GAME", accept: ["HINT"], ambiguous: false },
    });
  if (history.length > 0)
    for (const words of ["undo", "take that back"])
      add({
        seed,
        history,
        transcript: words,
        expect: { kind: "GAME", accept: ["UNDO"], ambiguous: false },
      });
  const [first, second] = moves;
  if (first !== undefined) {
    const confirm = { kind: "CONFIRMATION" as const, actionIds: [first.actionId] };
    for (const words of ["yes", "yeah do it", "confirm"])
      add({ seed, history, transcript: words, pending: confirm, expect: { kind: "RESPONSE" } });
    for (const words of ["no", "cancel that"])
      add({ seed, history, transcript: words, pending: confirm, expect: { kind: "RESPONSE" } });
  }
  if (first !== undefined && second !== undefined) {
    const choices = { kind: "CHOICES" as const, actionIds: [first.actionId, second.actionId] };
    for (const words of ["two", "number one", "the first one"])
      add({ seed, history, transcript: words, pending: choices, expect: { kind: "RESPONSE" } });
  }
}

const APP: [string, string][] = [
  ["make everything bigger", "ZOOM_IN"],
  ["zoom out", "ZOOM_OUT"],
  ["switch to dark mode", "SET_THEME"],
  ["use high contrast", "SET_THEME"],
  ["turn off the voice", "SET_VOICE_OUTPUT"],
  ["start a new game", "NEW_GAME"],
  ["go back home", "GO_HOME"],
  ["show me my stats", "SHOW_STATS"],
  ["open the settings", "SHOW_SETTINGS"],
  ["say that again", "REPEAT"],
];
const NONSENSE = ["what is the weather today", "sing me a song", "banana", "how old are you"];
for (const [index, seed] of SEEDS.slice(0, 2).entries()) {
  const { history } = position(seed, index);
  for (const [words, action] of APP)
    add({ seed, history, transcript: words, expect: { kind: "APP", action } });
  for (const words of NONSENSE)
    add({ seed, history, transcript: words, expect: { kind: "UNRECOGNIZED" } });
}

const set = EvalSetSchema.parse({ gameId: "spider-solitaire", cases });
writeFileSync(
  new URL("./spider-solitaire.cases.json", import.meta.url),
  `${JSON.stringify(set, null, 2)}\n`,
);
process.stdout.write(`Wrote ${String(set.cases.length)} cases.\n`);
