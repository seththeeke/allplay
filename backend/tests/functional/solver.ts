import { createHash } from "node:crypto";
import type { CompiledGame, GameState, LegalAction } from "../../src/game-engine";

const SEAT = "S1";

export interface SolverResult {
  actions: string[];
  state: GameState;
}

/**
 * Test-only solvers (game-engine.md section 11.2). They find the lines that
 * functional scenarios and golden games record; tests then replay those lines
 * rather than searching.
 */

/** A stable fingerprint of a final state, so golden replays must match exactly. */
export function stateHash(state: GameState): string {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

/** Follows the engine's own hints until the game ends, blocks, or `limit` actions pass. */
export function followHints(game: CompiledGame, state: GameState, limit = 400): SolverResult {
  const actions: string[] = [];
  let current = state;
  while (actions.length < limit && current.status === "IN_PROGRESS") {
    const hint = game.getHint(current, SEAT);
    if (hint === null) break;
    current = game.applyAction(current, SEAT, hint.actionId).state;
    actions.push(hint.actionId);
  }
  return { actions, state: current };
}

/** Plays a fixed line; every action must be legal where it is played. */
export function playLine(game: CompiledGame, state: GameState, line: readonly string[]): GameState {
  return line.reduce((current, actionId) => game.applyAction(current, SEAT, actionId).state, state);
}

/** Zones and face states only: two states with the same table are the same search node. */
function tableKey(state: GameState): string {
  return Object.values(state.zones)
    .map((pile) =>
      pile.map((id) => `${id}${state.cards[id]?.faceUp === true ? "+" : "-"}`).join(","),
    )
    .join("|");
}

const faceUpCount = (state: GameState): number =>
  Object.values(state.cards).filter((card) => card.faceUp).length;

/** Same-suit, one-rank-apart links among face-up cards: the progress a Spider player builds. */
function naturalLinks(state: GameState): number {
  let links = 0;
  for (const pile of Object.values(state.zones)) {
    for (let i = 1; i < pile.length; i += 1) {
      const low = state.cards[pile[i - 1] as string];
      const high = state.cards[pile[i] as string];
      if (
        low?.faceUp === true &&
        high?.faceUp === true &&
        high.suit === low.suit &&
        high.rank === low.rank - 1
      )
        links += 1;
    }
  }
  return links;
}

function emptyColumns(state: GameState): number {
  return Object.entries(state.zones).filter(
    ([zoneId, pile]) => zoneId.startsWith("tableau.") && pile.length === 0,
  ).length;
}

/** Board quality after a move: runs, then revealed cards, natural links and empty columns. */
function score(state: GameState): number {
  return (
    (state.vars["completedRuns"] ?? 0) * 10000 +
    faceUpCount(state) * 30 +
    naturalLinks(state) * 20 +
    emptyColumns(state) * 25
  );
}

/** Moves that only split a same-suit sequence a player has already built are never useful. */
function breaksNaturalLink(action: LegalAction, state: GameState): boolean {
  if (action.descriptor.kind !== "MOVE_CARDS") return false;
  const pile = state.zones[action.descriptor.from.zoneId] ?? [];
  const lead = state.cards[pile[pile.length - action.descriptor.cards.length] as string];
  const beneath = state.cards[pile[pile.length - action.descriptor.cards.length - 1] as string];
  return (
    beneath?.faceUp === true &&
    lead !== undefined &&
    beneath.suit === lead.suit &&
    beneath.rank === lead.rank + 1
  );
}

/**
 * Depth-first search for a win, children best first, with a visited set and a
 * node budget. Moves to equivalent empty columns are tried once.
 */
export function searchForWin(
  game: CompiledGame,
  start: GameState,
  budget = 200000,
): SolverResult | null {
  const seen = new Set<string>();
  const path: string[] = [];
  let nodes = 0;
  const visit = (state: GameState): GameState | null => {
    if (state.status === "WON") return state;
    if (nodes >= budget) return null;
    nodes += 1;
    const groups = new Set<string>();
    const children: { actionId: string; state: GameState; value: number }[] = [];
    for (const action of game.listLegalActions(state, SEAT)) {
      if (action.equivalenceKey !== undefined) {
        if (groups.has(action.equivalenceKey)) continue;
        groups.add(action.equivalenceKey);
      }
      if (breaksNaturalLink(action, state)) continue;
      const next = game.applyAction(state, SEAT, action.actionId).state;
      const key = tableKey(next);
      if (seen.has(key)) continue;
      seen.add(key);
      const dealPenalty = action.descriptor.kind === "DEAL" ? -500 : 0;
      children.push({ actionId: action.actionId, state: next, value: score(next) + dealPenalty });
    }
    children.sort((a, b) => b.value - a.value);
    for (const child of children) {
      path.push(child.actionId);
      const won = visit(child.state);
      if (won !== null) return won;
      path.pop();
    }
    return null;
  };
  seen.add(tableKey(start));
  const won = visit(start);
  return won === null ? null : { actions: [...path], state: won };
}

interface PhaseNode {
  state: GameState;
  actions: string[];
  value: number;
}

/** Non-deal successors of a state, skipping repeats, equivalent empty-column moves and broken links. */
function moves(game: CompiledGame, node: PhaseNode, seen: Set<string>): PhaseNode[] {
  const groups = new Set<string>();
  const out: PhaseNode[] = [];
  for (const action of game.listLegalActions(node.state, SEAT)) {
    if (action.descriptor.kind === "DEAL") continue;
    if (action.equivalenceKey !== undefined) {
      if (groups.has(action.equivalenceKey)) continue;
      groups.add(action.equivalenceKey);
    }
    if (breaksNaturalLink(action, node.state)) continue;
    const state = game.applyAction(node.state, SEAT, action.actionId).state;
    const key = tableKey(state);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ state, actions: [...node.actions, action.actionId], value: score(state) });
  }
  return out;
}

/**
 * Best-first search over moves between two deals: expands the highest-scoring
 * position first, up to `limit` expansions. Returns a win if one is reached,
 * else the best positions a deal can follow (no empty columns), best first.
 */
function searchPhase(game: CompiledGame, start: PhaseNode, limit: number): PhaseNode[] {
  const seen = new Set([tableKey(start.state)]);
  const frontier: PhaseNode[] = [start];
  const reached: PhaseNode[] = [start];
  for (let expanded = 0; expanded < limit && frontier.length > 0; expanded += 1) {
    frontier.sort((a, b) => a.value - b.value);
    const node = frontier.pop() as PhaseNode;
    for (const child of moves(game, node, seen)) {
      if (child.state.status === "WON") return [child];
      frontier.push(child);
      reached.push(child);
    }
  }
  return reached.sort((a, b) => b.value - a.value);
}

/**
 * Plays deal by deal: searches the moves available before each deal, then
 * deals from the best positions, backtracking over the top `branch` positions
 * per phase. Suited to Spider, where the stock splits a game into phases.
 */
export function searchByDeals(
  game: CompiledGame,
  start: GameState,
  options: { phaseLimit?: number; branch?: number } = {},
): SolverResult | null {
  const phaseLimit = options.phaseLimit ?? 4000;
  const branch = options.branch ?? 2;
  const solve = (node: PhaseNode): PhaseNode | null => {
    const reached = searchPhase(game, node, phaseLimit);
    if (reached[0]?.state.status === "WON") return reached[0];
    const dealable = reached.filter((candidate) =>
      game
        .listLegalActions(candidate.state, SEAT)
        .some((action) => action.descriptor.kind === "DEAL"),
    );
    for (const candidate of dealable.slice(0, branch)) {
      const dealt = game.applyAction(candidate.state, SEAT, "DEAL_ROW").state;
      const won = solve({
        state: dealt,
        actions: [...candidate.actions, "DEAL_ROW"],
        value: score(dealt),
      });
      if (won !== null) return won;
    }
    return null;
  };
  const won = solve({ state: start, actions: [], value: score(start) });
  return won === null ? null : { actions: won.actions, state: won.state };
}
