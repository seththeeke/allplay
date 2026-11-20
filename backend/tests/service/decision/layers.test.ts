import { describe, expect, it } from "vitest";
import { createBundledRulesRepository } from "../../../src/game-catalog";
import type {
  AppAction,
  GameCatalogEntry,
  GameView,
  SessionEnvelope,
} from "../../../src/models/api";
import { gamesBlock, selectAppAction } from "../../../src/service/decision/appSelector";
import { classify, transcriptBlock } from "../../../src/service/decision/classifier";
import { boardSummary, buildCandidates } from "../../../src/service/decision/gameSelector";
import { createFakeLlm } from "../../../src/service/decision/llm/fakeLlm";
import { appActionText, failureClassOf } from "../../../src/service/decision/outcomes";
import { guidanceBlock } from "../../../src/service/decision/prompts/gamePrompt";

describe("layer 1", () => {
  it("quotes the transcript and alternatives as data", () => {
    expect(transcriptBlock("<b>deal</b>", [{ transcript: "deal", confidence: 0.5 }])).toBe(
      '<transcript>(b)deal(/b)</transcript>\n<alternative confidence="0.50">deal</alternative>',
    );
  });

  it("turns unoffered categories and malformed output into UNRECOGNIZED", async () => {
    const input = {
      transcript: "x",
      alternatives: [],
      categories: ["APPLICATION", "UNRECOGNIZED"] as const,
      pending: null,
    };
    for (const answer of [{ category: "GAME" }, { nope: 1 }]) {
      const result = await classify(
        createFakeLlm(() => answer),
        { ...input, categories: [...input.categories] },
      );
      expect(result.category).toBe("UNRECOGNIZED");
    }
    const app = await classify(
      createFakeLlm(() => ({ category: "APPLICATION", response: "CONFIRM", optionNumber: 2 })),
      { ...input, categories: [...input.categories] },
    );
    expect(app).toMatchObject({ category: "APPLICATION", response: null, optionNumber: null });
    const choices = createFakeLlm(() => ({
      category: "RESPONSE",
      response: "CONFIRM",
      optionNumber: 2,
    }));
    const confirm = await classify(choices, {
      ...input,
      categories: ["RESPONSE"],
      pending: { kind: "CHOICES", choiceCount: 3 },
    });
    expect(confirm).toMatchObject({ response: "CONFIRM", optionNumber: null });
    expect(choices.requests[0]?.user).toContain("CHOICES, numbered 1 to 3");
  });
});

describe("layer 2 helpers", () => {
  it("summarizes hidden, empty and mixed zones", () => {
    const view = {
      zones: [
        {
          zoneId: "stock",
          type: "stock",
          index: 1,
          label: "stock",
          layout: "STACK",
          region: "BOTTOM",
          count: 50,
          cards: null,
        },
        {
          zoneId: "t1",
          type: "tableau",
          index: 1,
          label: "column 1",
          layout: "FAN_DOWN",
          region: "MAIN",
          count: 0,
          cards: [],
        },
        {
          zoneId: "t2",
          type: "tableau",
          index: 2,
          label: "column 2",
          layout: "FAN_DOWN",
          region: "MAIN",
          count: 2,
          cards: [
            { faceUp: false },
            { faceUp: true, cardId: "c", suit: "SPADES", rank: 7, name: "seven of spades" },
          ],
        },
        {
          zoneId: "t3",
          type: "tableau",
          index: 3,
          label: "column 3",
          layout: "FAN_DOWN",
          region: "MAIN",
          count: 1,
          cards: [{ faceUp: false }],
        },
      ],
    } as unknown as GameView;
    expect(boardSummary(view)).toBe(
      "stock: 50 cards\ncolumn 1: empty\ncolumn 2: 1 face down; face up from bottom to top: seven of spades\ncolumn 3: 1 face down",
    );
    expect(guidanceBlock("Toy", [])).toBe("The game is Toy.");
  });

  it("lists games with option labels", async () => {
    const games = await createBundledRulesRepository().list();
    expect(gamesBlock(games)).toContain("suits (1 = one suit, 2 = two suits, 4 = four suits)");
    const [first] = games as [GameCatalogEntry];
    const [option] = first.options as [GameCatalogEntry["options"][number]];
    expect(gamesBlock([{ ...first, options: [{ ...option, labels: {} }] }])).toContain("1 = 1");
    expect(gamesBlock([{ ...games[0], options: [] } as never])).toBe(
      "Games:\n- spider-solitaire: Spider Solitaire",
    );
  });

  it("validates application selections against the schema and the catalog", async () => {
    const games = await createBundledRulesRepository().list();
    const pick = (answer: unknown, currentGameId: string | null = null) =>
      selectAppAction(
        createFakeLlm(() => answer),
        {
          transcript: "x",
          alternatives: [],
          screen: "HOME",
          currentGameId,
          games,
        },
      );
    expect((await pick({ action: "NEW_GAME", params: {} })).action).toBeNull();
    expect(
      (await pick({ action: "NEW_GAME", params: { options: { suits: 2 } } }, "spider-solitaire"))
        .action,
    ).toEqual({
      action: "NEW_GAME",
      gameId: "spider-solitaire",
      options: { suits: 2 },
    });
    expect(
      (await pick({ action: "OPEN_GAME", params: { gameId: "spider-solitaire" } })).action,
    ).toEqual({
      action: "OPEN_GAME",
      gameId: "spider-solitaire",
    });
  });
});

describe("outcomes", () => {
  it("classifies every outcome", () => {
    expect(
      [
        "PROPOSED",
        "CHOICES",
        "APP_ACTION",
        "UNRECOGNIZED",
        "INVALID",
        "REJECTED",
        "CHOSE_OPTION",
        "CONFIRMED",
        "AUTO_APPLIED",
        "ACKNOWLEDGED",
        "RESOLVED",
        "EXPIRED",
      ].map((o) => failureClassOf(o as never)),
    ).toEqual([
      "PENDING",
      "PENDING",
      "PENDING",
      "HARD",
      "HARD",
      "HARD",
      "SOFT",
      "NONE",
      "NONE",
      "NONE",
      "NONE",
      "NONE",
    ]);
  });

  it("describes every application action", () => {
    const actions: AppAction[] = [
      { action: "ZOOM_IN" },
      { action: "ZOOM_OUT" },
      { action: "ZOOM_RESET" },
      { action: "SET_THEME", theme: "HIGH_CONTRAST" },
      { action: "SET_VOICE_OUTPUT", enabled: true },
      { action: "SET_VOICE_OUTPUT", enabled: false },
      { action: "SET_AUTO_CONFIRM", enabled: true },
      { action: "SET_AUTO_CONFIRM", enabled: false },
      { action: "REPEAT" },
      { action: "SHOW_HELP" },
      { action: "SHOW_STATS" },
      { action: "SHOW_SETTINGS" },
      { action: "GO_HOME" },
      { action: "OPEN_GAME", gameId: "g" },
      { action: "NEW_GAME", gameId: "g", options: {} },
      { action: "SIGN_IN" },
      { action: "SIGN_OUT" },
    ];
    const texts = actions.map(appActionText);
    expect(new Set(texts).size).toBe(actions.length);
    expect(texts[3]).toBe("Switching to high contrast.");
  });
});

describe("candidates", () => {
  it("collapses equivalence groups to their first member and lists meta actions first", () => {
    const action = (actionId: string, equivalenceKey?: string) => ({
      actionId,
      templateId: "MOVE_UNIT",
      params: {},
      descriptor: { kind: "OTHER" as const },
      text: `text ${actionId}`,
      shortText: actionId,
      ...(equivalenceKey === undefined ? {} : { equivalenceKey }),
    });
    const candidates = buildCandidates({
      metaActions: [
        { id: "UNDO", available: true },
        { id: "HINT", available: false },
      ],
      legalActions: [action("a", "empty"), action("b", "empty"), action("c")],
    } as unknown as SessionEnvelope);
    expect(candidates.map((c) => `${String(c.number)}:${c.actionId}`)).toEqual([
      "1:UNDO",
      "2:a",
      "3:c",
    ]);
  });
});
