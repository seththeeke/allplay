import { CONFIRMED_APP_ACTIONS, type DecisionResponse } from "../../models/api";
import type { Personality } from "./personality";

type Reply = Omit<DecisionResponse, "decisionId">;

export interface SpokenTurn {
  outcome: string;
  response: Reply;
  hint?: boolean;
  refused?: boolean;
}

const say = (response: Reply, text: string): Reply => ({
  ...response,
  displayText: text,
  speech: text,
});

/**
 * Puts a decided turn into the game speaker's words (conversational-ai.md
 * section 4.2). `turnIndex` rotates the acknowledgements so they do not repeat.
 */
export function speakTurn(turn: SpokenTurn, personality: Personality, turnIndex: number): Reply {
  const { response } = turn;
  const { acknowledgements } = personality;
  const acknowledgement = acknowledgements[turnIndex % acknowledgements.length] as string;
  switch (turn.outcome) {
    case "AUTO_APPLIED":
      return say(response, acknowledgement);
    case "RESOLVED":
      return response.session !== null || response.appAction !== null
        ? say(response, acknowledgement)
        : response;
    case "APP_ACTION": {
      const action = response.appAction?.action;
      /* A repeat replays the last line, and a destructive action still asks first. */
      if (action === undefined || action === "REPEAT" || CONFIRMED_APP_ACTIONS.has(action))
        return response;
      return say(response, acknowledgement);
    }
    case "PROPOSED":
      return turn.hint === true || response.proposal === null
        ? response
        : say(response, personality.confirm.replace("{action}", response.proposal.text));
    case "CHOICES": {
      const options = (response.choices ?? [])
        .map((choice) => `${String(choice.number)}, ${choice.text}.`)
        .join(" ");
      return say(response, personality.choices.replace("{options}", options));
    }
    case "UNRECOGNIZED":
      return turn.refused === true ? say(response, personality.notAllowed) : response;
    default:
      return response;
  }
}
