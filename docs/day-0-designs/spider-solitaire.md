# Spider Solitaire

Status: Day 0 design, 2026-11-17.

This document defines Spider Solitaire as a rules document for the game engine (`game-engine.md`), plus the Spider-specific voice vocabulary, client presentation and test plan. Spider Solitaire contains no engine code of its own: if a behavior here cannot be expressed with the engine primitives, the primitive is added to the engine generically.

Source rules: `docs/game-context/spider-solitaire/basics.md` (the Hoyle deal), with the Microsoft deal as the default per the Appendix of `0-day-0-project-idea.md`.

## 1. Rules Summary

1. Two standard 52-card packs (104 cards). The suit count option changes the suit mix while keeping 104 cards:
   - 1 suit: eight sets of spades.
   - 2 suits: four sets each of spades and hearts.
   - 4 suits: two sets each of spades, hearts, diamonds and clubs.
2. Ten columns form the tableau. Eight foundation slots hold completed runs. The stock holds undealt cards.
3. Deal styles:
   - `MICROSOFT` (default): 54 cards dealt by rows, columns 1 to 4 receive 6 cards and columns 5 to 10 receive 5. The stock holds 50 cards: five deals of 10.
   - `HOYLE`: 50 cards dealt, 5 per column. The stock holds 54 cards: five deals of 10 and a final deal of 4 onto columns 1 to 4.
   In both, the top card of each column is face up and the rest are face down.
4. A movable unit is the top card of a column together with the face-up cards beneath it that form a same-suit sequence descending toward the top. A player may move any top portion of that unit.
5. A unit may be placed on an empty column, or on a card one rank higher than the unit's bottom card, regardless of suit.
6. Moving every card of a column onto an empty column is not a legal move, because it changes nothing.
7. When a column's top card is face down, it turns face up automatically.
8. When the top 13 cards of a column form a same-suit sequence from king (deepest) to ace (top), they are removed to the next empty foundation slot automatically, for 100 points.
9. Dealing places one face-up card on each column from the stock. A deal is not allowed while any column is empty.
10. The game is won when all eight runs are complete. There is no losing status. A dead end (stock empty, no legal move, game not won) leaves the game `IN_PROGRESS` with `blocked: true`; the player can undo or abandon. An abandoned game, including an abandoned dead end, counts as a loss in statistics.
11. Scoring (Microsoft): start at 500, minus 1 for every move and every deal, plus 100 for every completed run, minus 1 for every undo. An undo does not refund the undone move's point, but it does take back a completed run bonus the undone move earned.

The home page offers one tile per suit count, from `backend/src/game-catalog/spider-solitaire/tiles.json` (`productionalization.md` Section 6).

## 2. Rules Document

File: `backend/src/game-catalog/spider-solitaire/rules.v1.json`.

```json
{
  "schemaVersion": 1,
  "gameId": "spider-solitaire",
  "version": 1,
  "name": "Spider Solitaire",
  "description": "Build eight full suits from king down to ace.",
  "path": "/spider",
  "players": { "min": 1, "max": 1 },

  "options": {
    "suits": {
      "type": "ENUM", "values": [1, 2, 4], "default": 1,
      "labels": { "1": "one suit", "2": "two suits", "4": "four suits" }
    },
    "dealStyle": {
      "type": "ENUM", "values": ["MICROSOFT", "HOYLE"], "default": "MICROSOFT",
      "labels": { "MICROSOFT": "standard deal", "HOYLE": "Hoyle deal" }
    }
  },

  "vars": {
    "score": { "initial": 500, "label": "score" },
    "completedRuns": { "initial": 0, "label": "completed runs" }
  },

  "derived": {
    "stockDealsRemaining": { "value": { "div": [{ "add": [{ "count": "stock.1" }, 9] }, 10] }, "label": "deals left" }
  },

  "cardSets": [{
    "id": "main",
    "copies": {
      "switch": { "option": "suits" },
      "cases": {
        "1": [{ "suits": ["SPADES"], "ranks": "A-K", "times": 8 }],
        "2": [{ "suits": ["SPADES", "HEARTS"], "ranks": "A-K", "times": 4 }],
        "4": [{ "suits": ["SPADES", "HEARTS", "DIAMONDS", "CLUBS"], "ranks": "A-K", "times": 2 }]
      }
    }
  }],

  "zones": [
    {
      "type": "stock", "count": 1,
      "label": { "singular": "stock", "plural": "stock", "numbered": false },
      "aliases": ["deck", "pile of cards"],
      "visibility": "COUNT_ONLY", "layout": "STACK", "region": "BOTTOM"
    },
    {
      "type": "foundation", "count": 8,
      "label": { "singular": "completed run", "plural": "completed runs", "numbered": false },
      "aliases": [],
      "visibility": "CARDS", "layout": "STACK", "region": "TOP"
    },
    {
      "type": "tableau", "count": 10,
      "label": { "singular": "column", "plural": "columns", "numbered": true },
      "aliases": ["pile", "stack", "row"],
      "visibility": "CARDS", "layout": "FAN_DOWN", "region": "MAIN"
    }
  ],

  "setup": [
    { "createCards": { "cardSet": "main", "into": "stock.1", "faceUp": false } },
    { "shuffle": { "zone": "stock.1" } },
    {
      "when": { "eq": [{ "option": "dealStyle" }, "MICROSOFT"] },
      "dealRows": { "from": "stock.1", "type": "tableau", "counts": [6, 6, 6, 6, 5, 5, 5, 5, 5, 5], "faceUp": false }
    },
    {
      "when": { "eq": [{ "option": "dealStyle" }, "HOYLE"] },
      "dealRows": { "from": "stock.1", "type": "tableau", "counts": [5, 5, 5, 5, 5, 5, 5, 5, 5, 5], "faceUp": false }
    }
  ],

  "actions": [
    {
      "id": "MOVE_UNIT",
      "kind": "MOVE_CARDS",
      "params": [
        {
          "name": "from",
          "domain": { "zones": { "type": "tableau" } },
          "prune": [{ "not": { "isEmpty": { "param": "from" } } }]
        },
        {
          "name": "depth",
          "domain": { "int": {
            "min": 1,
            "max": { "runLength": { "zone": { "param": "from" }, "rankStep": -1, "suit": "SAME", "faceUpOnly": true } }
          } }
        },
        {
          "name": "to",
          "domain": { "zones": { "type": "tableau" } },
          "prune": [{ "neq": [{ "param": "to" }, { "param": "from" }] }]
        }
      ],
      "require": [
        { "any": [
          { "isEmpty": { "param": "to" } },
          { "eq": [
            { "rank": { "card": { "zone": { "param": "to" }, "fromTop": 1 } } },
            { "add": [{ "rank": { "card": { "zone": { "param": "from" }, "fromTop": { "param": "depth" } } } }, 1] }
          ] }
        ] },
        { "not": { "all": [
          { "isEmpty": { "param": "to" } },
          { "eq": [{ "param": "depth" }, { "count": { "param": "from" } }] }
        ] } }
      ],
      "effects": [
        { "moveCards": { "from": { "param": "from" }, "count": { "param": "depth" }, "to": { "param": "to" } } }
      ],
      "score": -1,
      "countsAsMove": true,
      "equivalence": { "param": "to", "when": { "isEmpty": { "param": "to" } } }
    },
    {
      "id": "DEAL_ROW",
      "kind": "DEAL",
      "params": [],
      "require": [
        { "not": { "isEmpty": { "zone": "stock.1" } } },
        { "forAll": { "type": "tableau", "as": "z", "where": { "not": { "isEmpty": { "ref": "z" } } } } }
      ],
      "effects": [
        { "dealRow": { "from": { "zone": "stock.1" }, "type": "tableau", "faceUp": true } }
      ],
      "score": -1,
      "countsAsMove": true
    }
  ],

  "triggers": [
    {
      "id": "COMPLETE_RUN",
      "forEach": { "type": "tableau", "as": "z" },
      "when": { "all": [
        { "gte": [{ "count": { "ref": "z" } }, 13] },
        { "eq": [{ "rank": { "card": { "zone": { "ref": "z" }, "fromTop": 1 } } }, 1] },
        { "gte": [{ "runLength": { "zone": { "ref": "z" }, "rankStep": -1, "suit": "SAME", "faceUpOnly": true } }, 13] }
      ] },
      "effects": [
        { "emit": { "event": "RUN_COMPLETED", "data": {
          "zone": { "ref": "z" },
          "suit": { "suit": { "card": { "zone": { "ref": "z" }, "fromTop": 1 } } }
        } } },
        { "moveToFirstEmpty": { "from": { "ref": "z" }, "count": 13, "type": "foundation" } },
        { "addVar": { "name": "completedRuns", "by": 1 } }
      ],
      "score": 100
    },
    {
      "id": "FLIP_EXPOSED",
      "forEach": { "type": "tableau", "as": "z" },
      "when": { "all": [
        { "not": { "isEmpty": { "ref": "z" } } },
        { "not": { "faceUp": { "card": { "zone": { "ref": "z" }, "fromTop": 1 } } } }
      ] },
      "effects": [{ "flipTop": { "zone": { "ref": "z" }, "faceUp": true } }],
      "score": 0
    }
  ],

  "endConditions": [
    {
      "status": "WON",
      "when": { "forAll": { "type": "foundation", "as": "f", "where": { "eq": [{ "count": { "ref": "f" } }, 13] } } }
    }
  ],

  "undo": { "allowed": true, "score": -1, "refundUndoneAction": false },

  "hints": {
    "weights": [
      {
        "action": "MOVE_UNIT", "weight": 100,
        "when": { "all": [
          { "not": { "isNull": { "card": { "zone": { "param": "from" }, "fromTop": { "add": [{ "param": "depth" }, 1] } } } } },
          { "not": { "faceUp": { "card": { "zone": { "param": "from" }, "fromTop": { "add": [{ "param": "depth" }, 1] } } } } }
        ] }
      },
      {
        "action": "MOVE_UNIT", "weight": 60,
        "when": { "all": [
          { "eq": [{ "param": "depth" }, { "count": { "param": "from" } }] },
          { "not": { "isEmpty": { "param": "to" } } }
        ] }
      },
      {
        "action": "MOVE_UNIT", "weight": 50,
        "when": { "all": [
          { "not": { "isEmpty": { "param": "to" } } },
          { "eq": [
            { "suit": { "card": { "zone": { "param": "to" }, "fromTop": 1 } } },
            { "suit": { "card": { "zone": { "param": "from" }, "fromTop": { "param": "depth" } } } }
          ] }
        ] }
      },
      {
        "action": "MOVE_UNIT", "weight": -20,
        "when": { "isEmpty": { "param": "to" } }
      },
      {
        "action": "MOVE_UNIT", "weight": -300,
        "when": { "all": [
          { "not": { "isNull": { "card": { "zone": { "param": "from" }, "fromTop": { "add": [{ "param": "depth" }, 1] } } } } },
          { "faceUp": { "card": { "zone": { "param": "from" }, "fromTop": { "add": [{ "param": "depth" }, 1] } } } },
          { "eq": [
            { "rank": { "card": { "zone": { "param": "from" }, "fromTop": { "add": [{ "param": "depth" }, 1] } } } },
            { "add": [{ "rank": { "card": { "zone": { "param": "from" }, "fromTop": { "param": "depth" } } } }, 1] }
          ] }
        ] }
      },
      { "action": "DEAL_ROW", "weight": -50, "when": true },
      { "weight": -1000, "when": { "reversesLastAction": true } }
    ]
  },

  "speech": {
    "zoneAliases": {
      "tableau": ["column", "pile", "stack", "row"],
      "stock": ["stock", "deck"]
    },
    "actions": {
      "MOVE_UNIT": {
        "text": "Move {cards.lead} from {param.from} to {param.to}",
        "short": "{param.from} to {param.to}"
      },
      "DEAL_ROW": {
        "text": "Deal a new row of cards",
        "short": "deal"
      }
    },
    "events": {
      "RUN_COMPLETED": "Completed a run of {data.suit}",
      "GAME_WON": "You won. Final score {var.score}"
    },
    "deciderGuidance": ["<the five items of Section 3, verbatim>"]
  }
}
```

Notes on the document:

1. The hint weight that applies -300 penalizes moving a unit off a card it already sits on correctly (the card beneath is face up and one rank higher), which only makes sense when that card is a different suit. The +50 same-suit weight offsets it for the useful case of re-homing onto the same suit.
2. `COMPLETE_RUN` is declared before `FLIP_EXPOSED`, so removing a run that exposes a face-down card flips that card in the same trigger pass.
3. The final Hoyle deal of 4 cards requires no special rule: `dealRow` deals to columns in index order until the stock is empty.

## 3. Voice Vocabulary

The action decider (`action-decision.md`) receives the legal action list with engine text, plus this game-specific guidance, stored in the rules document as `speech.deciderGuidance` (one string per numbered item below):

1. Columns are numbered 1 to 10 from left to right. "Three to seven", "column three to column seven", "three on seven" and "move three over to seven" all mean move from column 3 to column 7.
2. When a column-to-column command matches more than one depth, the engine's rules already allow only the depth whose bottom card fits the target, so non-empty targets are unique. For an empty target, the largest movable unit is meant unless the player names a card.
3. Card references: "the seven of hearts", "the red seven" (two-suit and four-suit games), "the seven", "the black jack". Rank words: ace, two through ten, jack, queen, king. Players may say "on the eight" or "onto the eight of spades" for the target.
4. "Deal", "deal more cards", "next row", "more cards" all mean `DEAL_ROW`.
5. "Empty column", "open column", "the space" refer to any empty column; the engine's equivalence groups resolve which.

Transcribe custom vocabulary for Spider: spades, hearts, diamonds, clubs, ace, jack, queen, king, deal, undo, hint, column.

## 4. Client Presentation

1. Ten columns span the board width. Each column has its number (1 to 10) above it in a large label, at least 32 px at default zoom.
2. Cards overlap vertically. Face-down cards overlap tightly; face-up cards show rank and suit at the top-left and center with large indices.
3. The stock sits at the bottom right with a large label "Deal (4 left)". Pressing it deals. It is dimmed with the reason "Fill empty columns first" when a deal is not legal.
4. Completed runs show along the top as eight slots.
5. The header shows score, moves and the active option ("One suit").
6. When a voice action is proposed, the moving cards and the destination column are outlined and the proposal text is shown in a large banner with "Enter to confirm, Escape to cancel".
7. When the game is blocked, a banner offers "Undo" and "New game".
8. Animations: card moves slide in 200 ms, run completion collapses in 400 ms; both are instant when reduced motion is on.

## 5. Test Plan

1. Deal tests for every option combination: card count per column, face state, stock size (50 for Microsoft, 54 for Hoyle), and suit distribution.
2. Rule tests on hand-built states:
   - movable unit depth stops at a suit change and at a face-down card;
   - any rank-plus-one target accepts the unit regardless of suit;
   - kings and any unit move to empty columns;
   - whole-column-to-empty is excluded;
   - deal is illegal with an empty column and legal otherwise;
   - Hoyle final deal places 4 cards on columns 1 to 4;
   - run completion moves 13 cards, adds 100, increments `completedRuns`, and flips the exposed card;
   - win when the eighth run completes.
3. Scoring tests: move and deal cost 1, undo costs 1 and does not refund the move, undoing a run-completing move takes back the 100.
4. Equivalence tests: moves to two empty columns share an `equivalenceKey`.
5. Hint tests: exposing a face-down card beats a lateral move; deal is suggested only when no move has positive weight; a move that reverses the previous move is never suggested while another move exists.
6. Golden games: three recorded winning games (one per suit option) replayed from their seeds.
7. Simulation: the engine's rules validator (`game-engine.md` Section 13) passes for every option combination.
8. Functional playthroughs (`game-engine.md` Section 11.2): from fixed seeds, a recorded winning line ends `WON` with score and run counts asserted; a recorded losing line deals the stock early, reaches a dead end, and is abandoned.

## 6. Implementation Legs

Built in execution phase 5 (Game Engine) after GE-9.

| Leg | Scope |
|---|---|
| SP-1 | `rules.v1.json` with option, card set, zone and setup sections; deal tests for every option combination |
| SP-2 | `MOVE_UNIT` and `DEAL_ROW` actions; rule tests on hand-built states; equivalence tests |
| SP-3 | `COMPLETE_RUN` and `FLIP_EXPOSED` triggers, end condition, scoring and undo tests |
| SP-4 | Hint weights and hint tests; speech text and decider guidance |
| SP-5 | Golden games and simulation validation in CI; Spider registered in the bundled catalog |
