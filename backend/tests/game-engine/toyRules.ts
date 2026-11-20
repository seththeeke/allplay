/** A 20-card toy game that uses every primitive (game-engine.md section 17, GE-9). */
export function toyRules(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    gameId: "toy-game",
    version: 1,
    name: "Toy",
    description: "A small game for engine tests.",
    path: "/toy",
    players: { min: 1, max: 1 },
    options: {
      mode: {
        type: "ENUM",
        values: ["EASY", "HARD"],
        default: "EASY",
        labels: { EASY: "easy", HARD: "hard" },
      },
      size: { type: "ENUM", values: [1, 2], default: 1, labels: { "1": "small", "2": "large" } },
    },
    vars: {
      banked: { initial: 0, label: "banked" },
      flagged: { initial: 0, label: "flagged" },
      peeks: { initial: 0, label: "peeks" },
      bonus: {
        initial: { switch: { option: "mode" }, cases: { EASY: 1, HARD: 2 } },
        label: "bonus",
      },
    },
    derived: {
      deckCards: { value: { count: "deck.1" }, label: "cards in the deck" },
      notANumber: { value: "text", label: "not a number" },
    },
    cardSets: [
      { id: "main", copies: [{ suits: ["SPADES", "HEARTS"], ranks: [1, 2, 3, 4, 5], times: 2 }] },
      {
        id: "extra",
        copies: {
          switch: { option: "size" },
          cases: {
            "1": [{ suits: ["CLUBS"], ranks: "A-K", times: 1 }],
            "2": [{ suits: ["DIAMONDS"], ranks: "A-K", times: 1 }],
          },
        },
      },
    ],
    zones: [
      {
        type: "deck",
        count: 1,
        label: { singular: "deck", plural: "decks", numbered: false },
        aliases: [],
        visibility: "COUNT_ONLY",
        layout: "STACK",
        region: "BOTTOM",
      },
      {
        type: "pile",
        count: 3,
        label: { singular: "pile", plural: "piles", numbered: true },
        aliases: ["stack"],
        visibility: "CARDS",
        layout: "FAN_DOWN",
        region: "MAIN",
      },
      {
        type: "done",
        count: 2,
        label: { singular: "bank", plural: "banks", numbered: false },
        aliases: [],
        visibility: "CARDS",
        layout: "ROW",
        region: "TOP",
      },
    ],
    setup: [
      { createCards: { cardSet: "main", into: "deck.1", faceUp: false } },
      {
        when: { eq: [{ option: "mode" }, "HARD"] },
        createCards: { cardSet: "extra", into: "deck.1", faceUp: false },
      },
      {
        when: { eq: [{ option: "mode" }, "EASY"] },
        createCards: { cardSet: "extra", into: "done.2", faceUp: true },
      },
      { shuffle: { zone: "deck.1" } },
      { dealRows: { from: "deck.1", type: "pile", counts: [2, 2, 2], faceUp: false } },
      { setVar: { name: "bonus", value: { add: [{ var: "bonus" }, 10] } } },
    ],
    actions: [
      {
        id: "SHIFT",
        kind: "MOVE_CARDS",
        params: [
          {
            name: "from",
            domain: { zones: { type: "pile" } },
            prune: [{ not: { isEmpty: { param: "from" } } }],
          },
          {
            name: "n",
            domain: {
              int: {
                min: 1,
                max: {
                  runLength: {
                    zone: { param: "from" },
                    rankStep: -1,
                    suit: "ANY",
                    faceUpOnly: true,
                  },
                },
              },
            },
          },
          {
            name: "to",
            domain: { zones: { type: "pile" } },
            prune: [{ neq: [{ param: "to" }, { param: "from" }] }],
          },
        ],
        require: [
          {
            any: [
              { isEmpty: { param: "to" } },
              {
                eq: [
                  { rank: { card: { zone: { param: "to" }, fromTop: 1 } } },
                  {
                    add: [
                      { rank: { card: { zone: { param: "from" }, fromTop: { param: "n" } } } },
                      1,
                    ],
                  },
                ],
              },
            ],
          },
        ],
        effects: [
          { moveCards: { from: { param: "from" }, count: { param: "n" }, to: { param: "to" } } },
        ],
        score: -1,
        equivalence: { param: "to", when: { isEmpty: { param: "to" } } },
      },
      {
        id: "DRAW",
        kind: "DEAL",
        params: [],
        require: [{ not: { isEmpty: "deck.1" } }],
        effects: [{ dealRow: { from: "deck.1", type: "pile", faceUp: true } }],
        countsAsMove: false,
      },
      {
        id: "BANK",
        kind: "OTHER",
        params: [{ name: "src", domain: { zones: { type: "pile" } } }],
        require: [
          { gte: [{ count: { param: "src" } }, 1] },
          { allFaceUp: { cards: { zone: { param: "src" }, fromTop: 1 } } },
          { exists: { type: "done", as: "d", where: { isEmpty: { ref: "d" } } } },
        ],
        effects: [
          {
            emit: {
              event: "BANKED",
              data: {
                zone: { param: "src" },
                suit: { suit: { card: { zone: { param: "src" }, fromTop: 1 } } },
                cards: { cards: { zone: { param: "src" }, fromTop: 1 } },
                top: { card: { zone: { param: "src" }, fromTop: 1 } },
              },
            },
          },
          { moveToFirstEmpty: { from: { param: "src" }, count: 1, type: "done" } },
          { addVar: { name: "banked", by: 1 } },
        ],
        score: 5,
      },
      {
        id: "PEEK",
        kind: "MOVE_CARDS",
        params: [],
        require: [{ eq: [{ option: "mode" }, "HARD"] }],
        effects: [{ addVar: { name: "peeks", by: 1 } }],
        score: 0,
      },
      {
        id: "TURN",
        kind: "DEAL",
        params: [{ name: "at", domain: { zones: { type: "pile" } } }],
        require: [
          { not: { isEmpty: { param: "at" } } },
          { faceUp: { card: { zone: { param: "at" }, fromTop: 1 } } },
        ],
        effects: [{ flipTop: { zone: { param: "at" }, faceUp: false } }],
        score: -1,
      },
    ],
    triggers: [
      {
        id: "FLIP",
        forEach: { type: "pile", as: "z" },
        when: {
          all: [
            { not: { isEmpty: { ref: "z" } } },
            { not: { faceUp: { card: { zone: { ref: "z" }, fromTop: 1 } } } },
            { lt: [{ var: "moveCount" }, 100] },
            {
              eq: [
                { countZones: { type: "pile", as: "p", where: { isEmpty: { ref: "p" } } } },
                { countZones: { type: "pile", as: "q", where: { isEmpty: { ref: "q" } } } },
              ],
            },
          ],
        },
        effects: [{ flipTop: { zone: { ref: "z" }, faceUp: true } }],
      },
      {
        id: "FLAG",
        when: { all: [{ gte: [{ var: "banked" }, 2] }, { eq: [{ var: "flagged" }, 0] }] },
        effects: [{ addVar: { name: "flagged", by: 1 } }],
        score: 10,
      },
    ],
    endConditions: [
      { status: "LOST", when: { gte: [{ var: "peeks" }, 2] } },
      {
        status: "WON",
        when: { forAll: { type: "done", as: "d", where: { not: { isEmpty: { ref: "d" } } } } },
      },
    ],
    undo: { allowed: true, score: -2, refundUndoneAction: true },
    hints: {
      weights: [
        { action: "BANK", weight: 50, when: true },
        { action: "SHIFT", weight: 10, when: { isEmpty: { param: "to" } } },
        { weight: -1000, when: { reversesLastAction: true } },
      ],
    },
    speech: {
      zoneAliases: { pile: ["stack"] },
      actions: {
        SHIFT: {
          text: "Shift {cards.count} from {param.from} to {param.to} onto {target.top}, lead {cards.lead}, n {param.n} {var.score}{var.none}{plain}",
          short: "{param.from} to {param.to}",
        },
        DRAW: { text: "Draw {cards.lead}", short: "draw" },
        BANK: { text: "Bank {param.src}", short: "bank" },
        PEEK: { text: "Peek", short: "peek" },
        TURN: { text: "Turn {param.at}", short: "turn" },
      },
      events: {
        BANKED:
          "Banked {data.top} from {data.zone} of {data.suit}, score {var.score} {var.none} {other.x} {data.none}",
      },
    },
  };
}
