/*
 * Regenerates the voice playthrough commands (local-development.md section 6):
 *   npx tsx tests/functional/recordVoiceCommands.ts
 * It replays the one-suit golden game and writes one spoken command per move,
 * varying the phrasing, plus application commands, a hint and an undo, to
 * web-app/tests/voice-playthrough/spider-one-suit.commands.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createBundledRulesRepository } from "../../src/game-catalog";
import type { LegalAction } from "../../src/game-engine";

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
const golden = JSON.parse(
  readFileSync(new URL("../game-engine/golden/spider-one-suit.json", import.meta.url), "utf8"),
) as { seed: string; options: Record<string, string | number>; actions: string[] };
const game = createBundledRulesRepository().compiled("spider-solitaire");

type Confirm = "ENTER" | "YES" | "BUTTON";
type Step =
  | { say: string; expect: { kind: "GAME"; actionId: string }; confirm: Confirm }
  | { say: string; expect: { kind: "APP"; action: string; theme?: string } }
  | { say: string; expect: { kind: "HINT" } };

const column = (zone: string | number) => Number(String(zone).split(".")[1]);

/** One way a player could say this move, unambiguous among the legal moves. */
function phrase(action: LegalAction, legal: LegalAction[], turn: number): string {
  if (action.descriptor.kind !== "MOVE_CARDS") {
    return ["deal", "deal more cards", "next row", "more cards please"][turn % 4] as string;
  }
  const from = column(action.params["from"] as string);
  const to = column(action.params["to"] as string);
  const lead = action.descriptor.cards[0]?.name ?? "card";
  const top = action.descriptor.to.topCard?.name ?? null;
  const samePair = legal.filter(
    (other) =>
      other.params["from"] === action.params["from"] && other.params["to"] === action.params["to"],
  );
  const largest = Math.max(...samePair.map((other) => Number(other.params["depth"])));
  if (samePair.length > 1 && (top !== null || Number(action.params["depth"]) !== largest)) {
    return `move the ${lead} from column ${String(from)} to column ${String(to)}`;
  }
  const byCard = legal.filter(
    (other) =>
      other.descriptor.kind === "MOVE_CARDS" &&
      other.descriptor.cards[0]?.name === lead &&
      (other.descriptor.to.topCard?.name ?? null) === top,
  );
  const words = `${WORDS[from] ?? ""} to ${WORDS[to] ?? ""}`;
  /* "Move six to the empty column" is ambiguous when a six can move there, so empty targets name the column. */
  if (top === null) return `column ${WORDS[from] ?? ""} to the empty column ${WORDS[to] ?? ""}`;
  switch (turn % 4) {
    case 0:
      return words;
    case 1:
      return `column ${String(from)} to column ${String(to)}`;
    case 2:
      return `move ${WORDS[from] ?? ""} over to ${WORDS[to] ?? ""}`;
    default:
      return byCard.length === 1 ? `put the ${lead} on the ${top}` : words;
  }
}

const APP_STEPS: Record<number, Step> = {
  3: { say: "make the text bigger", expect: { kind: "APP", action: "ZOOM_IN" } },
  10: { say: "switch to dark mode", expect: { kind: "APP", action: "SET_THEME", theme: "DARK" } },
  15: { say: "what should I do next", expect: { kind: "HINT" } },
  45: { say: "zoom out a little", expect: { kind: "APP", action: "ZOOM_OUT" } },
  70: {
    say: "high contrast please",
    expect: { kind: "APP", action: "SET_THEME", theme: "HIGH_CONTRAST" },
  },
  100: { say: "make the font larger", expect: { kind: "APP", action: "ZOOM_IN" } },
};
const UNDO_AFTER = 25;
const CONFIRMS: Confirm[] = ["ENTER", "YES", "BUTTON"];

let state = game.createGame({ options: golden.options, seed: golden.seed, seats: ["S1"] });
const steps: Step[] = [];
golden.actions.forEach((actionId, turn) => {
  const extra = APP_STEPS[turn];
  if (extra !== undefined) steps.push(extra);
  const legal = game.listLegalActions(state, "S1");
  const action = legal.find((candidate) => candidate.actionId === actionId);
  if (action === undefined) throw new Error(`Move ${String(turn)} is not legal: ${actionId}`);
  const say = phrase(action, legal, turn);
  steps.push({ say, expect: { kind: "GAME", actionId }, confirm: CONFIRMS[turn % 3] as Confirm });
  if (turn === UNDO_AFTER) {
    steps.push({
      say: "take that back",
      expect: { kind: "GAME", actionId: "UNDO" },
      confirm: "ENTER",
    });
    steps.push({ say, expect: { kind: "GAME", actionId }, confirm: "ENTER" });
  }
  state = game.applyAction(state, "S1", actionId).state;
});
if (state.status !== "WON") throw new Error("The golden line no longer wins.");

writeFileSync(
  new URL(
    "../../../web-app/tests/voice-playthrough/spider-one-suit.commands.json",
    import.meta.url,
  ),
  `${JSON.stringify({ seed: golden.seed, options: golden.options, steps }, null, 2)}\n`,
);
process.stdout.write(`${String(steps.length)} steps written\n`);
