import type { AppAction } from "../../../models/api";

/** One line per application action, shared by layer 1 and layer 2 (action-decision.md section 7). */
export const APP_ACTION_LINES: Readonly<Record<AppAction["action"], string>> = {
  ZOOM_IN:
    'Make everything bigger: larger text, cards and buttons ("zoom in", "bigger", "make the text larger", "increase the font size", "I can\'t read it")',
  ZOOM_OUT:
    'Make everything smaller ("zoom out", "smaller", "make the text smaller", "decrease the font size")',
  ZOOM_RESET: 'Return to the normal size ("reset zoom", "normal size", "default text size")',
  SET_THEME:
    'Change the colors. theme is DEFAULT (the standard look), HIGH_CONTRAST ("high contrast", "more contrast"), BLACK_AND_WHITE ("black and white", "no colors"), FOUR_COLOR ("four color deck", "different color per suit") or DARK ("dark mode", "night mode", "dark theme")',
  SET_VOICE_OUTPUT:
    'Turn spoken replies on or off; enabled is true or false ("talk to me", "read things out loud", "stop talking", "be quiet")',
  SET_AUTO_CONFIRM:
    'Turn automatic confirmation of moves on or off; enabled is true or false ("stop asking me to confirm", "always ask first")',
  REPEAT: 'Say the last prompt again ("say that again", "repeat", "what did you say")',
  SHOW_HELP: 'Open the help page ("help", "how do I play", "what can I say")',
  SHOW_STATS: 'Open the statistics page ("show my stats", "how am I doing")',
  SHOW_SETTINGS: 'Open the settings page ("settings", "preferences")',
  GO_HOME: 'Go to the home page ("go home", "main menu", "back to the start")',
  OPEN_GAME: 'Open a game by gameId ("play spider", "open spider solitaire")',
  NEW_GAME:
    'Start a new game of gameId with options, leaving options empty to reuse the last ones ("new game", "start over", "deal a new two suit game")',
  SIGN_IN: 'Go to sign in ("sign in", "log in")',
  SIGN_OUT: 'Sign out ("sign out", "log out")',
};

export const appActionList = (): string =>
  Object.entries(APP_ACTION_LINES)
    .map(([action, line]) => `- ${action}: ${line}`)
    .join("\n");
