import type { Suit } from "../models/api";

/** Suit symbols and short rank labels for card faces; the full name is always the accessible label. */
export const SUIT_SYMBOL: Record<Suit, string> = {
  SPADES: String.fromCodePoint(0x2660),
  HEARTS: String.fromCodePoint(0x2665),
  DIAMONDS: String.fromCodePoint(0x2666),
  CLUBS: String.fromCodePoint(0x2663),
};

export const SUIT_COLOR_CLASS: Record<Suit, string> = {
  SPADES: "text-spades",
  HEARTS: "text-hearts",
  DIAMONDS: "text-diamonds",
  CLUBS: "text-clubs",
};

const FACES: Record<number, string> = { 1: "A", 11: "J", 12: "Q", 13: "K" };

export function rankLabel(rank: number): string {
  return FACES[rank] ?? String(rank);
}
