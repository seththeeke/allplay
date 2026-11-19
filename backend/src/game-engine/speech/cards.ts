import type { CardFace, CardState } from "../types";

const RANK_NAMES = [
  "ace",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "jack",
  "queen",
  "king",
];

/** Spoken rank word: 1 is "ace", 13 is "king". */
export function rankName(rank: number): string {
  return RANK_NAMES[rank - 1] ?? String(rank);
}

/** The fixed card name every client and the decider use, for example "ten of hearts" (game-engine.md section 4.12). */
export function cardName(card: Pick<CardState, "suit" | "rank">): string {
  return `${rankName(card.rank)} of ${card.suit.toLowerCase()}`;
}

export function cardFace(cardId: string, card: CardState): CardFace {
  return { cardId, suit: card.suit, rank: card.rank, name: cardName(card) };
}
