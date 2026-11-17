import { describe, expect, it } from "vitest";
import { mockDecide, normalize } from "../../test-data/decider";
import { toEnvelope } from "../../test-data/spider/envelope";
import { createSpider, parseOptions } from "../../test-data/spider/simulator";
import type { LegalAction } from "../../src/models/api";
import { must } from "../must";

const legal: LegalAction[] = toEnvelope({
  sessionId: "s",
  status: "IN_PROGRESS",
  version: 0,
  state: createSpider(parseOptions({}), 7),
}).legalActions;
const decide = (
  transcript: string,
  pending: "CONFIRMATION" | "CHOICES" | null = null,
  game = true,
) =>
  mockDecide({
    transcript,
    pending,
    legalActions: game ? legal : null,
    gameId: game ? "spider-solitaire" : null,
  });

const firstMove = must(
  legal.find(
    (action) => action.descriptor.kind === "MOVE_CARDS" && action.descriptor.to.topCard !== null,
  ),
);
const move = firstMove.descriptor.kind === "MOVE_CARDS" ? firstMove.descriptor : null;

describe("mock decider", () => {
  it("normalizes punctuation and case", () => {
    expect(normalize("  Three, to SEVEN!  ")).toBe("three to seven");
  });

  it("answers pending prompts", () => {
    expect(decide("yes please", "CONFIRMATION")).toEqual({
      kind: "RESPONSE",
      response: "CONFIRM",
      optionNumber: null,
    });
    expect(decide("cancel", "CHOICES")).toEqual({
      kind: "RESPONSE",
      response: "REJECT",
      optionNumber: null,
    });
    expect(decide("number two", "CHOICES")).toEqual({
      kind: "RESPONSE",
      response: "OPTION",
      optionNumber: 2,
    });
    expect(decide("3", "CHOICES")).toEqual({
      kind: "RESPONSE",
      response: "OPTION",
      optionNumber: 3,
    });
    expect(decide("two", "CONFIRMATION").kind).not.toBe("RESPONSE");
  });

  it.each([
    ["zoom in", { action: "ZOOM_IN" }],
    ["make it smaller", { action: "ZOOM_OUT" }],
    ["reset zoom", { action: "ZOOM_RESET" }],
    ["change the theme to high contrast", { action: "SET_THEME", theme: "HIGH_CONTRAST" }],
    ["black and white colors", { action: "SET_THEME", theme: "BLACK_AND_WHITE" }],
    ["four colour deck style", { action: "SET_THEME", theme: "FOUR_COLOR" }],
    ["dark mode", { action: "SET_THEME", theme: "DARK" }],
    ["normal theme", { action: "SET_THEME", theme: "DEFAULT" }],
    ["stop talking", { action: "SET_VOICE_OUTPUT", enabled: false }],
    ["turn voice on", { action: "SET_VOICE_OUTPUT", enabled: true }],
    ["auto confirm on", { action: "SET_AUTO_CONFIRM", enabled: true }],
    ["auto confirm off", { action: "SET_AUTO_CONFIRM", enabled: false }],
    ["repeat that", { action: "REPEAT" }],
    ["help", { action: "SHOW_HELP" }],
    ["show my stats", { action: "SHOW_STATS" }],
    ["open settings", { action: "SHOW_SETTINGS" }],
    ["go home", { action: "GO_HOME" }],
    ["sign out", { action: "SIGN_OUT" }],
    ["log in", { action: "SIGN_IN" }],
    ["play spider", { action: "OPEN_GAME", gameId: "spider-solitaire" }],
    ["new game", { action: "NEW_GAME", gameId: "spider-solitaire", options: {} }],
    [
      "new game with two suits",
      { action: "NEW_GAME", gameId: "spider-solitaire", options: { suits: 2 } },
    ],
    [
      "new four suit game",
      { action: "NEW_GAME", gameId: "spider-solitaire", options: { suits: 4 } },
    ],
    [
      "new one suit game",
      { action: "NEW_GAME", gameId: "spider-solitaire", options: { suits: 1 } },
    ],
  ])("understands %s", (transcript, action) => {
    expect(decide(transcript)).toEqual({ kind: "APP", action });
  });

  it("opens a new spider game from outside a game", () => {
    expect(decide("new game", null, false)).toEqual({
      kind: "APP",
      action: { action: "NEW_GAME", gameId: "spider-solitaire", options: {} },
    });
  });

  it("understands undo, hint and deal in a game only", () => {
    expect(decide("undo")).toEqual({ kind: "META", meta: "UNDO" });
    expect(decide("what can i do")).toEqual({ kind: "META", meta: "HINT" });
    expect(decide("deal more cards")).toEqual({ kind: "GAME", actionIds: ["DEAL_ROW"] });
    expect(decide("deal", null, false)).toEqual({ kind: "UNRECOGNIZED" });
    expect(
      mockDecide({ transcript: "deal", pending: null, legalActions: [], gameId: "x" }),
    ).toEqual({
      kind: "GAME",
      actionIds: [],
    });
  });

  it("maps column commands to the deepest matching move", () => {
    const from = String(move?.from.index);
    const to = String(move?.to.index);
    expect(decide(`move ${from} to ${to}`)).toEqual({
      kind: "GAME",
      actionIds: [firstMove.actionId],
    });
    expect(decide(`column ${from} onto column ${to}`)).toEqual({
      kind: "GAME",
      actionIds: [firstMove.actionId],
    });
    expect(decide("eleven to twelve")).toEqual({ kind: "UNRECOGNIZED" });
    expect(decide("9 to 9")).toEqual({ kind: "GAME", actionIds: [] });
  });

  it("maps card names with optional suit and target", () => {
    const lead = must(move?.cards[0]);
    const target = must(move?.to.topCard);
    const rank = must(lead.name.split(" ")[0]);
    const targetRank = must(target.name.split(" ")[0]);
    expect(decide(`${lead.name} onto the ${targetRank}`).kind).toBe("GAME");
    expect(
      (decide(`the ${rank} to the ${targetRank}`) as { actionIds: string[] }).actionIds,
    ).toContain(firstMove.actionId);
    expect(decide(`${rank} of hearts`)).toEqual({ kind: "GAME", actionIds: [] });
    expect(decide(`${rank} to the empty`)).toEqual({ kind: "GAME", actionIds: [] });
    expect(decide("sing me a song")).toEqual({ kind: "UNRECOGNIZED" });
  });
});
