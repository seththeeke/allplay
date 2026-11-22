import type { HelpStep } from "../components/HelpWalkthrough";

/** First-game tour for card games (0-day-0-project-idea.md, Help Content). */
export const GAME_HELP_STEPS: HelpStep[] = [
  {
    target: "talk",
    title: "Talk to play",
    body: 'Press the Space bar or the Talk button, then say what you want, like "three to seven" or "deal".',
  },
  {
    target: "board",
    title: "Every column has a number",
    body: "Say the column numbers to move cards. You can also name a card, like the seven of spades onto the eight.",
  },
  {
    target: "board",
    title: "Or tap the cards",
    body: "Tap a card, and the places it can go light up. Tap one of them to move it there.",
  },
  {
    target: "game-actions",
    title: "Undo and hints",
    body: 'Say "undo" to take back a move, or "hint" to see a good move.',
  },
  {
    target: "talk",
    title: "Confirm with Enter",
    body: 'Before a move happens, press Enter or say "yes". Press Escape or say "no" to cancel.',
  },
  {
    target: "settings",
    title: "Make it easier to see",
    body: 'Say "zoom in", "zoom out" or "high contrast" while you play, or open Settings.',
  },
];
