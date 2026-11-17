import type { AppAction, GameOptions, LegalAction, Theme } from "../src/models/api";

/**
 * Rule-based stand-in for the two LLM layers (action-decision.md sections 5
 * to 7), so the prototype's voice flow works offline. It returns the same
 * shapes the real decider does; the phrases it understands are a small
 * subset of what Bedrock will handle.
 */

export type MockDecision =
  | { kind: "RESPONSE"; response: "CONFIRM" | "REJECT" | "OPTION"; optionNumber: number | null }
  | { kind: "APP"; action: AppAction }
  | { kind: "GAME"; actionIds: string[] }
  | { kind: "META"; meta: "UNDO" | "HINT" }
  | { kind: "UNRECOGNIZED" };

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  won: 1,
  two: 2,
  to: 2,
  too: 2,
  three: 3,
  four: 4,
  for: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  ate: 8,
  nine: 9,
  ten: 10,
};

const RANK_WORDS: Record<string, number> = {
  ace: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  jack: 11,
  queen: 12,
  king: 13,
};

const THEMES: [RegExp, Theme][] = [
  [/high contrast/, "HIGH_CONTRAST"],
  [/black and white|black & white|grayscale|greyscale/, "BLACK_AND_WHITE"],
  [/four colou?r/, "FOUR_COLOR"],
  [/dark/, "DARK"],
  [/default|normal|regular/, "DEFAULT"],
];

export function normalize(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/[^a-z0-9& ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numberAt(word: string | undefined): number | null {
  if (word === undefined) return null;
  const digit = Number(word);
  if (Number.isInteger(digit) && digit > 0) return digit;
  return NUMBER_WORDS[word] ?? null;
}

function respond(text: string, pending: "CONFIRMATION" | "CHOICES" | null): MockDecision | null {
  if (pending === null) return null;
  if (/^(yes|yeah|yep|confirm|do it|ok|okay|sure)\b/.test(text)) {
    return { kind: "RESPONSE", response: "CONFIRM", optionNumber: null };
  }
  if (/^(no|nope|cancel|stop|never mind)\b/.test(text)) {
    return { kind: "RESPONSE", response: "REJECT", optionNumber: null };
  }
  const option = numberAt(text.replace(/^(number|option) /, "").split(" ")[0]);
  if (pending === "CHOICES" && option !== null && option <= 4 && text.split(" ").length <= 2) {
    return { kind: "RESPONSE", response: "OPTION", optionNumber: option };
  }
  return null;
}

function appAction(text: string, gameId: string | null): AppAction | null {
  if (/\b(zoom in|bigger|larger)\b/.test(text)) return { action: "ZOOM_IN" };
  if (/\b(zoom out|smaller)\b/.test(text)) return { action: "ZOOM_OUT" };
  if (/\breset zoom\b/.test(text)) return { action: "ZOOM_RESET" };
  if (/\b(theme|style|colou?rs?|contrast|mode)\b/.test(text)) {
    const match = THEMES.find(([pattern]) => pattern.test(text));
    if (match !== undefined) return { action: "SET_THEME", theme: match[1] };
  }
  if (/\b(voice|speak|talk|read)\b.*\b(off|stop|quiet)\b|\bstop talking\b/.test(text)) {
    return { action: "SET_VOICE_OUTPUT", enabled: false };
  }
  if (/\b(voice|speak|talk|read)\b.*\b(on|start|aloud)\b|\btalk to me\b/.test(text)) {
    return { action: "SET_VOICE_OUTPUT", enabled: true };
  }
  if (/\bauto ?confirm\b/.test(text))
    return { action: "SET_AUTO_CONFIRM", enabled: !/\boff\b/.test(text) };
  if (/\b(repeat|say that again)\b/.test(text)) return { action: "REPEAT" };
  if (/\bhelp\b/.test(text)) return { action: "SHOW_HELP" };
  if (/\b(stats|statistics)\b/.test(text)) return { action: "SHOW_STATS" };
  if (/\bsettings\b/.test(text)) return { action: "SHOW_SETTINGS" };
  if (/\b(home|main menu)\b/.test(text)) return { action: "GO_HOME" };
  if (/\bsign out\b|\blog out\b/.test(text)) return { action: "SIGN_OUT" };
  if (/\bsign in\b|\blog in\b/.test(text)) return { action: "SIGN_IN" };
  if (/\bnew\b.*\bgame\b|\bstart over\b/.test(text)) {
    const suits = /\b(one|1) suit\b/.test(text)
      ? 1
      : /\b(two|2) suits?\b/.test(text)
        ? 2
        : /\b(four|4) suits?\b/.test(text)
          ? 4
          : null;
    const options: GameOptions = suits === null ? {} : { suits };
    return { action: "NEW_GAME", gameId: gameId ?? "spider-solitaire", options };
  }
  if (/\b(play|open)\b.*\bspider\b/.test(text))
    return { action: "OPEN_GAME", gameId: "spider-solitaire" };
  return null;
}

/** Collapses empty-column equivalents, then keeps the largest unit per source and destination. */
function collapse(actions: LegalAction[]): LegalAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = action.equivalenceKey ?? action.actionId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function gameActions(text: string, legal: LegalAction[]): string[] | null {
  const moves = legal.filter((action) => action.descriptor.kind === "MOVE_CARDS");
  const columns = /(?:column )?(\w+) (?:to|on|onto|over to|in) (?:column )?(\w+)/.exec(
    text.replace(/^move /, ""),
  );
  const from = numberAt(columns?.[1]);
  const to = numberAt(columns?.[2]);
  if (from !== null && to !== null && !RANK_WORDS[columns?.[1] ?? ""]) {
    const matching = moves.filter(
      (action) =>
        action.descriptor.kind === "MOVE_CARDS" &&
        action.descriptor.from.index === from &&
        action.descriptor.to.index === to,
    );
    const deepest = matching.sort((left, right) => cardCount(right) - cardCount(left))[0];
    return deepest === undefined ? [] : [deepest.actionId];
  }
  const cardMatch =
    /(ace|two|three|four|five|six|seven|eight|nine|ten|jack|queen|king)(?: of (spades|hearts|diamonds|clubs))?(?: (?:to|on|onto) (?:the )?(ace|two|three|four|five|six|seven|eight|nine|ten|jack|queen|king|empty))?/.exec(
      text,
    );
  if (cardMatch === null) return null;
  const rank = RANK_WORDS[cardMatch[1] ?? ""];
  const suit = cardMatch[2]?.toUpperCase();
  const target = cardMatch[3];
  const matching = moves.filter((action) => {
    if (action.descriptor.kind !== "MOVE_CARDS") return false;
    const lead = action.descriptor.cards[0];
    const topCard = action.descriptor.to.topCard;
    if (lead === undefined || lead.rank !== rank || (suit !== undefined && lead.suit !== suit))
      return false;
    if (target === "empty") return topCard === null;
    return target === undefined || topCard?.rank === RANK_WORDS[target];
  });
  return collapse(matching).map((action) => action.actionId);
}

function cardCount(action: LegalAction): number {
  return action.descriptor.kind === "MOVE_CARDS" ? action.descriptor.cards.length : 0;
}

export interface MockDecideInput {
  transcript: string;
  pending: "CONFIRMATION" | "CHOICES" | null;
  legalActions: LegalAction[] | null;
  gameId: string | null;
}

export function mockDecide({
  transcript,
  pending,
  legalActions,
  gameId,
}: MockDecideInput): MockDecision {
  const text = normalize(transcript);
  const response = respond(text, pending);
  if (response !== null) return response;
  const app = appAction(text, gameId);
  if (app !== null) return { kind: "APP", action: app };
  if (legalActions !== null) {
    if (/^(undo|take (that|it) back|go back)\b/.test(text)) return { kind: "META", meta: "UNDO" };
    if (/^(hint|help me|what can i do|any moves)\b/.test(text))
      return { kind: "META", meta: "HINT" };
    if (/\b(deal|more cards|next row)\b/.test(text)) {
      const deal = legalActions.find((action) => action.descriptor.kind === "DEAL");
      return { kind: "GAME", actionIds: deal === undefined ? [] : [deal.actionId] };
    }
    const ids = gameActions(text, legalActions);
    if (ids !== null) return { kind: "GAME", actionIds: ids };
  }
  return { kind: "UNRECOGNIZED" };
}
