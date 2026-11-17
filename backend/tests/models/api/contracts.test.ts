import { describe, expect, it } from "vitest";
import {
  AppActionSchema,
  ApiErrorSchema,
  ApplyActionRequestSchema,
  CONFIRMED_APP_ACTIONS,
  DEFAULT_APP_PREFERENCES,
  DEFAULT_GAME_PREFERENCES,
  DayMetricsSchema,
  DecisionRequestSchema,
  DecisionResponseSchema,
  DeploymentsResponseSchema,
  GamesResponseSchema,
  HintResponseSchema,
  MergeRequestSchema,
  MergeTokenResponseSchema,
  PASSWORD_RULE,
  passwordProblem,
  PlayerMeSchema,
  PreferencesResponseSchema,
  ResolutionRequestSchema,
  SessionEnvelopeSchema,
  StartSessionRequestSchema,
  StatsResponseSchema,
  type LegalAction,
  type SessionEnvelope,
} from "../../../src/models/api";

const sevenOfSpades = { cardId: "c17", suit: "SPADES", rank: 7, name: "seven of spades" } as const;
const eightOfHearts = { cardId: "c33", suit: "HEARTS", rank: 8, name: "eight of hearts" } as const;

const move: LegalAction = {
  actionId: "MOVE_UNIT|from=tableau.4|depth=1|to=tableau.2",
  templateId: "MOVE_UNIT",
  params: { from: "tableau.4", depth: 1, to: "tableau.2" },
  descriptor: {
    kind: "MOVE_CARDS",
    cards: [sevenOfSpades],
    from: { zoneId: "tableau.4", type: "tableau", index: 4, label: "column 4" },
    to: {
      zoneId: "tableau.2",
      type: "tableau",
      index: 2,
      label: "column 2",
      topCard: eightOfHearts,
    },
  },
  text: "Move seven of spades from column 4 to column 2",
  shortText: "column 4 to column 2",
};

const envelope: SessionEnvelope = {
  session: {
    sessionId: "01JEX4Q8N6W2D3K5T7V9B1C3E5",
    gameId: "spider-solitaire",
    status: "IN_PROGRESS",
    version: 38,
    options: { suits: 1, dealStyle: "MICROSOFT" },
    summary: { score: 464, moveCount: 34 },
  },
  view: {
    gameId: "spider-solitaire",
    rulesVersion: 1,
    options: { suits: 1, dealStyle: "MICROSOFT" },
    status: { status: "IN_PROGRESS", blocked: false, canUndo: true },
    vars: { score: 464 },
    zones: [
      {
        zoneId: "stock.1",
        type: "stock",
        index: 1,
        label: "stock",
        layout: "STACK",
        region: "BOTTOM",
        count: 40,
        cards: null,
      },
      {
        zoneId: "tableau.2",
        type: "tableau",
        index: 2,
        label: "column 2",
        layout: "FAN_DOWN",
        region: "MAIN",
        count: 2,
        cards: [{ faceUp: false }, { ...eightOfHearts, faceUp: true }],
      },
    ],
  },
  legalActions: [
    move,
    {
      actionId: "DEAL_ROW",
      templateId: "DEAL_ROW",
      params: {},
      descriptor: {
        kind: "DEAL",
        from: { zoneId: "stock.1", type: "stock", index: 1, label: "stock" },
        cardCount: 10,
      },
      text: "Deal a new row of cards",
      shortText: "deal",
    },
  ],
  metaActions: [
    { id: "UNDO", available: true },
    { id: "HINT", available: true },
  ],
  events: [{ type: "CARD_FLIPPED", data: { zone: "tableau.4", cardId: "c61" }, speech: null }],
};

describe("session contracts", () => {
  it("accept the envelope from game-engine.md section 11", () => {
    expect(SessionEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  it("reject a face-down card that leaks its identity", () => {
    const leaky = structuredClone(envelope) as unknown as {
      view: { zones: { cards: unknown[] }[] };
    };
    leaky.view.zones[1]?.cards.splice(0, 1, { faceUp: false, suit: "SPADES" });
    const parsed = SessionEnvelopeSchema.parse(leaky);
    expect(parsed.view.zones[1]?.cards?.[0]).toEqual({ faceUp: false });
  });

  it("validate requests", () => {
    expect(
      StartSessionRequestSchema.safeParse({ gameId: "spider-solitaire", options: { suits: 2 } })
        .success,
    ).toBe(true);
    expect(
      ApplyActionRequestSchema.safeParse({
        actionId: move.actionId,
        expectedVersion: 38,
        source: "VOICE",
      }).success,
    ).toBe(true);
    expect(
      ApplyActionRequestSchema.safeParse({
        actionId: move.actionId,
        expectedVersion: -1,
        source: "VOICE",
      }).success,
    ).toBe(false);
    expect(
      HintResponseSchema.safeParse({ action: null, text: "No moves. Deal or undo." }).success,
    ).toBe(true);
  });
});

describe("catalog contracts", () => {
  it("accept a game entry with options", () => {
    const games = {
      games: [
        {
          gameId: "spider-solitaire",
          name: "Spider Solitaire",
          description: "Build eight full suits from king down to ace.",
          path: "/spider",
          latestVersion: 1,
          players: { min: 1, max: 1 },
          options: [
            {
              name: "suits",
              type: "ENUM",
              values: [1, 2, 4],
              default: 1,
              labels: { "1": "one suit", "2": "two suits", "4": "four suits" },
            },
          ],
          source: "CORE",
        },
      ],
    };
    expect(GamesResponseSchema.parse(games)).toEqual(games);
    expect(
      GamesResponseSchema.safeParse({ games: [{ ...games.games[0], path: "spider" }] }).success,
    ).toBe(false);
  });
});

describe("decision contracts", () => {
  it("default alternatives and validate context", () => {
    const parsed = DecisionRequestSchema.parse({
      transcript: "three to seven",
      transcriptSource: "TRANSCRIBE",
      context: { screen: "GAME", sessionId: "s1", expectedVersion: 3, pendingDecisionId: null },
    });
    expect(parsed.alternatives).toEqual([]);
  });

  it("accept a choices response and reject a single choice", () => {
    const response = {
      decisionId: "d1",
      outcome: "CHOICES",
      displayText: "There are two eights.",
      speech: "There are two eights.",
      proposal: null,
      choices: [
        { number: 1, actionId: "a", text: "column 2" },
        { number: 2, actionId: "b", text: "column 9" },
      ],
      appAction: null,
      session: null,
    };
    expect(DecisionResponseSchema.safeParse(response).success).toBe(true);
    expect(
      DecisionResponseSchema.safeParse({ ...response, choices: [response.choices[0]] }).success,
    ).toBe(false);
  });

  it("validate application actions and their confirmation rule", () => {
    expect(AppActionSchema.parse({ action: "SET_THEME", theme: "FOUR_COLOR" })).toEqual({
      action: "SET_THEME",
      theme: "FOUR_COLOR",
    });
    expect(AppActionSchema.safeParse({ action: "SET_THEME", theme: "PINK" }).success).toBe(false);
    expect(CONFIRMED_APP_ACTIONS.has("NEW_GAME")).toBe(true);
    expect(CONFIRMED_APP_ACTIONS.has("ZOOM_IN")).toBe(false);
  });

  it("validate resolutions", () => {
    expect(
      ResolutionRequestSchema.safeParse({
        resolution: "CHOSE_OPTION",
        optionNumber: 2,
        expectedVersion: 37,
        clientLatencyMs: 1615,
      }).success,
    ).toBe(true);
  });
});

describe("player contracts", () => {
  it("accept defaults and reject out of range preferences", () => {
    expect(
      PreferencesResponseSchema.parse({
        app: DEFAULT_APP_PREFERENCES,
        games: { "spider-solitaire": DEFAULT_GAME_PREFERENCES },
      }).app.zoomLevel,
    ).toBe(1.25);
    expect(
      PreferencesResponseSchema.safeParse({
        app: { ...DEFAULT_APP_PREFERENCES, zoomLevel: 1.3 },
        games: {},
      }).success,
    ).toBe(false);
  });

  it("accept players, stats and merge tokens", () => {
    expect(
      PlayerMeSchema.safeParse({
        playerId: "GUEST#us-east-1:x",
        kind: "GUEST",
        tier: "GUEST",
        displayName: null,
        email: null,
      }).success,
    ).toBe(true);
    expect(
      StatsResponseSchema.safeParse({
        stats: [
          {
            gameId: "spider-solitaire",
            variantKey: "dealStyle=MICROSOFT;suits=1",
            gamesPlayed: 14,
            gamesWon: 9,
            gamesLost: 5,
            bestScore: 1182,
            fastestWinMoves: 104,
            currentWinStreak: 3,
            longestWinStreak: 4,
            totalMoves: 1873,
            lastPlayedAt: "2026-12-03T09:12:40.017Z",
          },
        ],
      }).success,
    ).toBe(true);
    const token = "a".repeat(43);
    expect(
      MergeTokenResponseSchema.safeParse({ token, expiresAt: "2026-12-02T15:30:45.000Z" }).success,
    ).toBe(true);
    expect(MergeRequestSchema.safeParse({ token: "short" }).success).toBe(false);
  });
});

describe("admin and error contracts", () => {
  it("accept day metrics and deployments", () => {
    expect(
      DayMetricsSchema.safeParse({
        period: "2026-12-02",
        totalPlayers: 412,
        totalAccounts: 37,
        totalGuests: 375,
        activePlayers30d: 128,
        newPlayers: 19,
        gamesStarted: { "spider-solitaire": 96 },
        gamesWon: { "spider-solitaire": 31 },
        gamesAbandoned: { "spider-solitaire": 44 },
        decisions: 2210,
        hardFailures: 204,
        softFailures: 151,
        llmCalls: 4010,
        llmInputTokens: 7230500,
        llmOutputTokens: 151200,
        clientLatencyP50Ms: 1420,
        clientLatencyP95Ms: 2810,
        serverLatencyP50Ms: 890,
        serverLatencyP95Ms: null,
      }).success,
    ).toBe(true);
    expect(
      DeploymentsResponseSchema.safeParse({
        deployments: [
          {
            executionId: "e1",
            status: "SUCCEEDED",
            trigger: "SCHEDULE",
            startedAt: "2026-12-02T10:00:00.000Z",
            lastUpdatedAt: "2026-12-02T10:24:00.000Z",
            stages: [{ name: "DeployTest", status: "SUCCEEDED" }],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("carry the current envelope on a version conflict", () => {
    const conflict = ApiErrorSchema.parse({
      code: "VERSION_CONFLICT",
      message: "stale",
      current: envelope,
    });
    expect(conflict.current?.session.version).toBe(38);
    expect(ApiErrorSchema.safeParse({ code: "TEAPOT", message: "x" }).success).toBe(false);
  });
});

describe("password policy", () => {
  it("requires length, upper case, lower case and a digit", () => {
    expect(passwordProblem("Spider2026")).toBeNull();
    expect(passwordProblem("short1A")).toBe(PASSWORD_RULE);
    expect(passwordProblem("alllowercase1")).toBe(PASSWORD_RULE);
    expect(passwordProblem("ALLUPPERCASE1")).toBe(PASSWORD_RULE);
    expect(passwordProblem("NoDigitsHere")).toBe(PASSWORD_RULE);
  });
});
