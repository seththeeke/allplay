import { describe, expect, it } from "vitest";
import vocabulary from "../../src/game-catalog/vocabulary.json";

/** Spider's Transcribe words (spider-solitaire.md section 3) and the application command words (action-decision.md section 3). */
const SPIDER = [
  "spades",
  "hearts",
  "diamonds",
  "clubs",
  "ace",
  "jack",
  "queen",
  "king",
  "deal",
  "undo",
  "hint",
  "column",
];
const APPLICATION = ["zoom", "theme", "contrast", "undo", "hint", "confirm"];

describe("Transcribe custom vocabulary", () => {
  it("holds every core game's words and the application command words, once each", () => {
    for (const word of [...SPIDER, ...APPLICATION]) expect(vocabulary.phrases).toContain(word);
    expect(new Set(vocabulary.phrases).size).toBe(vocabulary.phrases.length);
  });

  it("uses only phrases Transcribe accepts: lowercase letters, hyphens and apostrophes, under 256 characters", () => {
    for (const phrase of vocabulary.phrases) {
      expect(phrase).toMatch(/^[a-z][a-z'-]*$/);
      expect(phrase.length).toBeLessThan(256);
    }
  });
});
