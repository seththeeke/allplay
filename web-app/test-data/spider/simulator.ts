import type { GameEvent, GameOptions, LegalAction, ZoneRef } from "../../src/models/api";
import { cardName, createCards, face, seededRandom, shuffle, type SimCard } from "./cards";

/**
 * Prototype stand-in for the server's Spider Solitaire rules. It follows
 * spider-solitaire.md closely enough to play, so the web prototype can be
 * exercised end to end; the real engine (game-engine.md) replaces it.
 */

export interface SpiderState {
  options: { suits: number; dealStyle: "MICROSOFT" | "HOYLE" };
  seed: number;
  cards: Record<string, SimCard>;
  zones: Record<string, string[]>;
  vars: { score: number; moveCount: number; undoCount: number; completedRuns: number };
  scoreCarry: number;
  history: string[];
}

const COLUMNS = 10;
const RUNS = 8;
const tableau = (index: number): string => `tableau.${String(index)}`;
const foundation = (index: number): string => `foundation.${String(index)}`;
const STOCK = "stock.1";

export function parseOptions(options: GameOptions | undefined): SpiderState["options"] {
  const suits = Number(options?.["suits"] ?? 1);
  return {
    suits: [1, 2, 4].includes(suits) ? suits : 1,
    dealStyle: options?.["dealStyle"] === "HOYLE" ? "HOYLE" : "MICROSOFT",
  };
}

function zoneCards(state: SpiderState, zoneId: string): SimCard[] {
  return (state.zones[zoneId] ?? []).map((id) => state.cards[id] as SimCard);
}

function top(state: SpiderState, zoneId: string, fromTop = 1): SimCard | undefined {
  const cards = zoneCards(state, zoneId);
  return cards[cards.length - fromTop];
}

export function createSpider(options: SpiderState["options"], seed: number): SpiderState {
  const deck = shuffle(createCards(options.suits), seededRandom(seed));
  const state: SpiderState = {
    options,
    seed,
    cards: Object.fromEntries(deck.map((card) => [card.id, { ...card }])),
    zones: { [STOCK]: deck.map((card) => card.id) },
    vars: { score: 500, moveCount: 0, undoCount: 0, completedRuns: 0 },
    scoreCarry: 0,
    history: [],
  };
  for (let index = 1; index <= COLUMNS; index += 1) state.zones[tableau(index)] = [];
  for (let index = 1; index <= RUNS; index += 1) state.zones[foundation(index)] = [];
  const counts =
    options.dealStyle === "MICROSOFT"
      ? [6, 6, 6, 6, 5, 5, 5, 5, 5, 5]
      : Array<number>(COLUMNS).fill(5);
  for (let row = 0; row < 6; row += 1) {
    counts.forEach((count, column) => {
      if (row < count) state.zones[tableau(column + 1)]?.push(state.zones[STOCK]?.pop() as string);
    });
  }
  settle(state, []);
  return state;
}

/** Runs automatic effects until nothing changes: complete runs, then flip exposed cards. */
function settle(state: SpiderState, events: GameEvent[]): void {
  for (let index = 1; index <= COLUMNS; index += 1) {
    const zoneId = tableau(index);
    if (runLength(state, zoneId) >= 13 && top(state, zoneId)?.rank === 1) {
      const run = state.zones[zoneId]?.splice(-13) ?? [];
      const target = Array.from({ length: RUNS }, (_, slot) => foundation(slot + 1)).find(
        (id) => state.zones[id]?.length === 0,
      );
      if (target !== undefined) state.zones[target] = run;
      state.vars.completedRuns += 1;
      state.vars.score += 100;
      const suit = (state.cards[run[0] as string] as SimCard).suit.toLowerCase();
      events.push({
        type: "RUN_COMPLETED",
        data: { zone: zoneId, suit },
        speech: `Completed a run of ${suit}`,
      });
    }
    const exposed = top(state, zoneId);
    if (exposed !== undefined && !exposed.faceUp) {
      exposed.faceUp = true;
      events.push({
        type: "CARD_FLIPPED",
        data: { zone: zoneId, cardId: exposed.id },
        speech: null,
      });
    }
  }
}

/** Face-up, same-suit run at the top of a column, each card one rank below the card beneath it. */
export function runLength(state: SpiderState, zoneId: string): number {
  const cards = zoneCards(state, zoneId);
  let length = 0;
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    const card = cards[index] as SimCard;
    const above = cards[index + 1];
    if (!card.faceUp) break;
    if (above !== undefined && (above.suit !== card.suit || above.rank !== card.rank - 1)) break;
    length += 1;
  }
  return length;
}

function zoneRef(zoneId: string): ZoneRef {
  const [type = "", index = "1"] = zoneId.split(".");
  return {
    zoneId,
    type,
    index: Number(index),
    label: type === "tableau" ? `column ${index}` : type,
  };
}

export function legalActions(state: SpiderState): LegalAction[] {
  const actions: LegalAction[] = [];
  for (let from = 1; from <= COLUMNS; from += 1) {
    const fromId = tableau(from);
    const count = state.zones[fromId]?.length ?? 0;
    for (let depth = 1; depth <= runLength(state, fromId); depth += 1) {
      const lead = top(state, fromId, depth) as SimCard;
      for (let to = 1; to <= COLUMNS; to += 1) {
        const toId = tableau(to);
        const target = top(state, toId);
        const empty = target === undefined;
        if (to === from || (empty && depth === count) || (!empty && target.rank !== lead.rank + 1))
          continue;
        const moving = zoneCards(state, fromId).slice(-depth);
        const actionId = `MOVE_UNIT|from=${fromId}|depth=${String(depth)}|to=${toId}`;
        const toLabel = empty ? `empty column ${String(to)}` : `column ${String(to)}`;
        actions.push({
          actionId,
          templateId: "MOVE_UNIT",
          params: { from: fromId, depth, to: toId },
          descriptor: {
            kind: "MOVE_CARDS",
            cards: moving.map(face),
            from: zoneRef(fromId),
            to: { ...zoneRef(toId), topCard: empty ? null : face(target) },
          },
          text: `Move ${cardName(lead)} from column ${String(from)} to ${toLabel}`,
          shortText: `column ${String(from)} to ${toLabel}`,
          ...(empty
            ? { equivalenceKey: `MOVE_UNIT|from=${fromId}|depth=${String(depth)}|to=*` }
            : {}),
        });
      }
    }
  }
  const stock = state.zones[STOCK]?.length ?? 0;
  const allFilled = Array.from({ length: COLUMNS }, (_, index) => tableau(index + 1)).every(
    (id) => (state.zones[id]?.length ?? 0) > 0,
  );
  if (stock > 0 && allFilled) {
    actions.push({
      actionId: "DEAL_ROW",
      templateId: "DEAL_ROW",
      params: {},
      descriptor: { kind: "DEAL", from: zoneRef(STOCK), cardCount: Math.min(stock, COLUMNS) },
      text: "Deal a new row of cards",
      shortText: "deal",
    });
  }
  return actions;
}

/** Applies a legal action id; returns the events, or null when the action is not legal. */
export function applyAction(state: SpiderState, actionId: string): GameEvent[] | null {
  if (!legalActions(state).some((action) => action.actionId === actionId)) return null;
  const events: GameEvent[] = [];
  if (actionId === "DEAL_ROW") {
    const dealt: string[] = [];
    for (let index = 1; index <= COLUMNS && (state.zones[STOCK]?.length ?? 0) > 0; index += 1) {
      const id = state.zones[STOCK]?.pop() as string;
      (state.cards[id] as SimCard).faceUp = true;
      state.zones[tableau(index)]?.push(id);
      dealt.push(id);
    }
    events.push({ type: "CARDS_DEALT", data: { cardIds: dealt }, speech: null });
  } else {
    const params: Record<string, string> = Object.fromEntries(
      actionId
        .split("|")
        .slice(1)
        .map((part) => part.split("=") as [string, string]),
    );
    const [from, to, depth] = [params["from"] ?? "", params["to"] ?? "", Number(params["depth"])];
    const moved = state.zones[from]?.splice(-depth) ?? [];
    state.zones[to]?.push(...moved);
    events.push({ type: "CARDS_MOVED", data: { from, to, cardIds: moved }, speech: null });
  }
  state.vars.score -= 1;
  state.vars.moveCount += 1;
  state.history.push(actionId);
  settle(state, events);
  return events;
}

/** Undo by replay from the seed, as the engine does (game-engine.md section 7.4). */
export function undo(state: SpiderState): SpiderState | null {
  if (state.history.length === 0) return null;
  const replayed = createSpider(state.options, state.seed);
  for (const actionId of state.history.slice(0, -1)) applyAction(replayed, actionId);
  replayed.scoreCarry = state.scoreCarry - 2;
  replayed.vars.undoCount = state.vars.undoCount + 1;
  replayed.vars.score += replayed.scoreCarry;
  replayed.vars.moveCount = state.vars.moveCount;
  return replayed;
}

export function isWon(state: SpiderState): boolean {
  return state.vars.completedRuns === RUNS;
}

export function stockDealsRemaining(state: SpiderState): number {
  return Math.ceil((state.zones[STOCK]?.length ?? 0) / COLUMNS);
}

/** Simple hint weighting: expose face-down cards, then same-suit builds; deal last. */
export function hint(state: SpiderState): LegalAction | null {
  const weigh = (action: LegalAction): number => {
    if (action.descriptor.kind !== "MOVE_CARDS") return -50;
    const { from, to, cards } = action.descriptor;
    const beneath = top(state, from.zoneId, cards.length + 1);
    let weight = 0;
    if (beneath !== undefined && !beneath.faceUp) weight += 100;
    if (to.topCard !== null && to.topCard.suit === cards[0]?.suit) weight += 50;
    if (to.topCard === null) weight -= 20;
    if (beneath?.faceUp === true && beneath.rank === (cards[0]?.rank ?? 0) + 1) weight -= 300;
    return weight;
  };
  const ranked = legalActions(state).sort((left, right) => weigh(right) - weigh(left));
  return ranked[0] ?? null;
}
