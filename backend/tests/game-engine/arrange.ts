import type { GameState, Suit } from "../../src/game-engine";

export type CardSpec = [rank: number, suit: Suit, faceUp: boolean];

/**
 * Rearranges a created state into a hand-built table: each listed zone gets
 * cards matching the specs (bottom first), and every other card goes to
 * `rest`, so card conservation still holds.
 */
export function arrange(
  state: GameState,
  table: Record<string, CardSpec[]>,
  rest: string,
): GameState {
  const next = structuredClone(state);
  const pool = new Set(Object.keys(next.cards));
  for (const zoneId of Object.keys(next.zones)) next.zones[zoneId] = [];
  for (const [zoneId, specs] of Object.entries(table)) {
    next.zones[zoneId] = specs.map(([rank, suit, faceUp]) => {
      const cardId = [...pool].find(
        (id) => next.cards[id]?.rank === rank && next.cards[id].suit === suit,
      );
      if (cardId === undefined) throw new Error(`No spare ${String(rank)} of ${suit}`);
      pool.delete(cardId);
      next.cards[cardId] = { rank, suit, faceUp };
      return cardId;
    });
  }
  for (const cardId of pool) {
    (next.cards[cardId] as { faceUp: boolean }).faceUp = false;
    (next.zones[rest] as string[]).push(cardId);
  }
  return next;
}
