import type { CardFace, Suit } from "../../src/models/api";

/** Card helpers for the prototype's Spider simulator (spider-solitaire.md section 1). */

export interface SimCard {
  id: string;
  suit: Suit;
  rank: number;
  faceUp: boolean;
}

const RANK_WORDS = [
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
] as const;

export function cardName(card: Pick<SimCard, "suit" | "rank">): string {
  return `${RANK_WORDS[card.rank - 1] ?? String(card.rank)} of ${card.suit.toLowerCase()}`;
}

export function face(card: SimCard): CardFace {
  return { cardId: card.id, suit: card.suit, rank: card.rank, name: cardName(card) };
}

const SUITS_BY_OPTION: Record<number, Suit[]> = {
  1: ["SPADES"],
  2: ["SPADES", "HEARTS"],
  4: ["SPADES", "HEARTS", "DIAMONDS", "CLUBS"],
};

/** 104 cards: the chosen suits repeated until two full packs are used. */
export function createCards(suitCount: number): SimCard[] {
  const suits = SUITS_BY_OPTION[suitCount] ?? ["SPADES"];
  const copies = 8 / suits.length;
  const cards: SimCard[] = [];
  for (let copy = 0; copy < copies; copy += 1) {
    for (const suit of suits) {
      for (let rank = 1; rank <= 13; rank += 1) {
        cards.push({ id: `c${String(cards.length)}`, suit, rank, faceUp: false });
      }
    }
  }
  return cards;
}

/** Deterministic mulberry32 generator so a seed always produces the same deal. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const held = result[index] as T;
    result[index] = result[swap] as T;
    result[swap] = held;
  }
  return result;
}
