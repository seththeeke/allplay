import type { AppAction } from "../../models/api";
import type { Decision } from "../../models/decision";

/** Failure class of an outcome (action-decision.md section 9); open outcomes have none yet. */
export function failureClassOf(outcome: Decision["outcome"]): Decision["failureClass"] {
  switch (outcome) {
    case "PROPOSED":
    case "CHOICES":
    case "APP_ACTION":
      return undefined;
    case "UNRECOGNIZED":
    case "INVALID":
    case "REJECTED":
      return "HARD";
    case "CHOSE_OPTION":
      return "SOFT";
    default:
      return "NONE";
  }
}

const THEMES: Record<string, string> = {
  DEFAULT: "the standard colors",
  HIGH_CONTRAST: "high contrast",
  BLACK_AND_WHITE: "black and white",
  FOUR_COLOR: "the four color deck",
  DARK: "dark mode",
};

/** What the player sees and hears for an application action. */
export function appActionText(action: AppAction): string {
  switch (action.action) {
    case "ZOOM_IN":
      return "Making everything bigger.";
    case "ZOOM_OUT":
      return "Making everything smaller.";
    case "ZOOM_RESET":
      return "Back to the normal size.";
    case "SET_THEME":
      return `Switching to ${THEMES[action.theme] ?? action.theme}.`;
    case "SET_VOICE_OUTPUT":
      return action.enabled ? "Spoken replies are on." : "Spoken replies are off.";
    case "SET_AUTO_CONFIRM":
      return action.enabled ? "Moves will be made without asking." : "I will ask before each move.";
    case "REPEAT":
      return "Repeating.";
    case "SHOW_HELP":
      return "Opening help.";
    case "SHOW_STATS":
      return "Opening your stats.";
    case "SHOW_SETTINGS":
      return "Opening settings.";
    case "GO_HOME":
      return "Going home.";
    case "OPEN_GAME":
      return "Opening the game.";
    case "NEW_GAME":
      return "Start a new game";
    case "SIGN_IN":
      return "Go to sign in";
    case "SIGN_OUT":
      return "Sign out";
  }
}

/** Fixed replies of the decider (action-decision.md section 6). */
export const TEXT = {
  slowDown: "Let's slow down for a moment. Try again in a minute.",
  cancelled: "Cancelled.",
  done: "Done.",
  sayNumber: "Say the number of the move you want, or say cancel.",
  sayYesOrNo: "Say yes to confirm, or no to cancel.",
  noSuchChoice: "There is no choice with that number.",
  noGame: "There is no game in progress. Say new game to start one.",
  whichMove:
    "I'm not sure which move you mean. Try naming the column numbers, like three to seven, or say hint for a suggestion.",
  notAllowed: (move: string) =>
    `That move is not allowed right now: ${move}. Say hint if you'd like a suggestion.`,
  hint: (move: string) => `Hint: ${move}. Confirm to make this move.`,
  noHint: "There are no moves left. Try undo or a new game.",
  ignored: "No game request heard.",
  unrecognized: "I didn't understand that. Try a move like three to seven, or say help.",
  choices: (count: number) => `There are ${String(count)} matching moves.`,
  modelUnavailable: (detail: string) => `I can't understand commands right now: ${detail}`,
  modelUnavailableSpeech: "I can't understand commands right now.",
} as const;
