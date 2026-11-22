# Game Engine

Status: Day 0 design, 2026-11-17.

The game engine is the backbone of All Play. It interprets declarative rules documents, owns all game state transitions, enumerates every legal action, and is the only component that can change a game. Everything else (the HTTP API, the action decider, the clients) talks to it through the public interface defined here.

Related specs: `data-model.md` (persistence of engine state), `action-decision.md` (consumer of legal actions), `spider-solitaire.md` (the first rules document), `cdk-stacks.md` (hosting).

## 1. Principles

1. Data-driven. Every game, including Spider Solitaire, is a rules document (JSON) interpreted by one generic engine. No game has game-specific engine code. A behavior a rules document cannot express is added as a new generic primitive (Section 5), never as a game branch.
2. Pure. The engine performs no I/O, reads no clock, and uses no ambient randomness. Given the same rules document, options, seed and action history, it produces byte-identical state.
3. Server only. The engine runs only inside backend Lambdas. Clients never compute rules; they render the view and the legal action list the server returns.
4. Restrictive. The only way to change state is `applyAction` with an `actionId` that `listLegalActions` produced for that exact state, or `undo`. Every mutation is validated.
5. Hidden information stays hidden. Face-down cards, the stock order and the seed never leave the server. The engine produces a redacted view per seat.
6. Isolated. `backend/src/game-engine/` imports nothing from the rest of the backend and has no runtime dependencies except `zod`. Lint rules enforce this (Section 16).

## 2. Concepts

| Term | Meaning |
|---|---|
| Rules document | JSON describing one game: options, components, zones, setup, actions, triggers, end conditions, scoring, hints and speech text |
| Compiled game | A rules document after validation and pre-processing, cached per Lambda container |
| Game state | Full authoritative state of one session, including hidden cards and the seed |
| View | Redacted state for one seat; what clients receive |
| Action template | A parameterized move declared in the rules, for example "move a unit from one column to another" |
| Legal action | One fully bound instance of a template that passes all of its requirements in the current state |
| Action id | Deterministic string identifying a legal action, for example `MOVE_UNIT|from=tableau.3|depth=2|to=tableau.7` |
| Trigger | An automatic effect the engine runs after setup and after every action, for example flipping an exposed card |
| Event | A record of something that happened during a mutation, used for animation and speech |
| Seat | A participant slot in a session; Spider Solitaire has one seat, `S1` |

## 3. Rules Sources

The engine loads rules through a `RulesRepository` interface supplied by the session service:

```ts
interface RulesRepository {
  get(gameId: string, version: number): Promise<RulesDocument>;
  latest(gameId: string): Promise<RulesDocument>;
  list(): Promise<GameCatalogEntry[]>;
}
```

Two implementations exist:

1. `BundledRulesRepository` serves core games from `backend/src/game-catalog/<gameId>/rules.v<N>.json`. These files are reviewed, tested and versioned in git. A released version is never edited; a rules change ships as `rules.v<N+1>.json`, and existing sessions keep playing the version pinned in their state.
2. `CommunityRulesRepository` serves `GameDefinition` items (`data-model.md` Section 13). It is built in the Game Building phase.

The catalog entry (`list()`) exposes `gameId`, `name`, `description`, `path` (the direct web route, for example `/spider`), `latestVersion`, `options` (with defaults and spoken labels), `players`, and `source` (`CORE` or `COMMUNITY`). Rules documents carry `path` as a top-level field.

## 4. Rules Document Format

A rules document is JSON validated by the zod schema `RulesDocumentSchema` in `game-engine/rules/schema.ts`. Schema version 1 covers card games with one or more seats. Top-level shape:

```json
{
  "schemaVersion": 1,
  "gameId": "spider-solitaire",
  "version": 1,
  "name": "Spider Solitaire",
  "description": "Build eight full suits from king down to ace.",
  "players": { "min": 1, "max": 1 },
  "options": {},
  "vars": {},
  "derived": {},
  "cardSets": [],
  "zones": [],
  "setup": [],
  "actions": [],
  "triggers": [],
  "endConditions": [],
  "undo": {},
  "hints": {},
  "speech": {}
}
```

### 4.1 Options

Options are the choices a player makes when starting a game. Each has a type, allowed values, a default, and spoken labels the action decider uses ("one suit", "four suits").

```json
"options": {
  "suits": {
    "type": "ENUM", "values": [1, 2, 4], "default": 1,
    "labels": { "1": "one suit", "2": "two suits", "4": "four suits" }
  },
  "dealStyle": {
    "type": "ENUM", "values": ["MICROSOFT", "HOYLE"], "default": "MICROSOFT",
    "labels": { "MICROSOFT": "standard deal", "HOYLE": "Hoyle deal" }
  }
}
```

`variantKey` (used for statistics) is the options sorted by name and joined as `name=value;name=value`.

### 4.2 Vars

Named numeric counters held in state. Every game automatically has `score`, `moveCount` and `undoCount`. Rules declare any others with an initial value expression.

```json
"vars": {
  "score": { "initial": 500, "label": "score" },
  "completedRuns": { "initial": 0, "label": "completed runs" }
}
```

### 4.2.1 Derived Vars

Derived vars are read-only numbers computed from state whenever a view is built. They appear in the view's `vars` and in the session `summary`, never in stored state. A name may not repeat a var. A value that is not a number reads as 0.

```json
"derived": {
  "stockDealsRemaining": { "value": { "div": [{ "add": [{ "count": "stock.1" }, 9] }, 10] }, "label": "deals left" }
}
```

### 4.3 Card Sets

Card sets declare which physical cards exist. Suits are `SPADES`, `HEARTS`, `DIAMONDS`, `CLUBS`. Ranks are integers 1 (ace) to 13 (king); `"A-K"` is shorthand for 1 through 13. Colors are derived (spades and clubs are `BLACK`, hearts and diamonds are `RED`). Every card instance gets a unique id at creation (`c0`, `c1`, ...).

```json
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
}]
```

### 4.4 Zones

A zone type declares a group of ordered card containers. Instances are numbered from 1 and identified as `<type>.<n>`, for example `tableau.3`. Card order within a zone is bottom first, top last.

| Field | Meaning |
|---|---|
| `type` | Zone type name |
| `count` | Number of instances |
| `label` | Spoken and displayed name: `{ "singular": "column", "plural": "columns", "numbered": true }` gives "column 3" |
| `aliases` | Other words players use for this zone type, for example `["pile", "stack"]` |
| `visibility` | `CARDS` (face-up cards visible, face-down cards redacted) or `COUNT_ONLY` (only the card count is visible) |
| `layout` | Rendering hint for clients: `FAN_DOWN`, `STACK`, `ROW` |
| `region` | Rendering hint: `TOP`, `MAIN`, `BOTTOM` |

### 4.5 Expressions

Rules use a JSON expression language. Expressions are evaluated against the current state and the action's bound parameters. There are no strings of code; every expression is a JSON object with exactly one operator key, which makes rules documents schema-valid by construction and safe to generate with an LLM later (moonshot).

Value expressions:

| Expression | Result |
|---|---|
| `1`, `"SPADES"`, `true` | Literal |
| `{ "param": "from" }` | Bound action parameter (zone id or integer) |
| `{ "option": "suits" }` | Game option value |
| `{ "var": "score" }` | Var value |
| `{ "ref": "z" }` | Iteration variable bound by `forAll` / `exists` / `forEach` |
| `{ "zone": "stock.1" }` | Zone id literal |
| `{ "count": <zone> }` | Number of cards in a zone |
| `{ "cards": { "zone": <zone>, "fromTop": <n> } }` | The top `n` cards of a zone, bottom first |
| `{ "card": { "zone": <zone>, "fromTop": <n> } }` | The `n`th card from the top (1 is the top card); null when absent |
| `{ "rank": <card> }`, `{ "suit": <card> }`, `{ "color": <card> }`, `{ "faceUp": <card> }` | Card properties |
| `{ "runLength": { "zone": <zone>, "rankStep": -1, "suit": "SAME", "faceUpOnly": true } }` | Length of the longest sequence at the top of the zone where each card is `rankStep` from the one beneath it, honoring the suit rule |
| `{ "countZones": { "type": "tableau", "as": "z", "where": <predicate> } }` | Number of zone instances matching a predicate |
| `{ "add": [a, b] }`, `{ "sub": [a, b] }`, `{ "min": [a, b] }`, `{ "max": [a, b] }` | Arithmetic |
| `{ "div": [a, b] }` | Integer division rounded down; null when `b` is 0 |
| `{ "switch": <value>, "cases": { ... }, "default": <value> }` | Branch on a value |

Anywhere a zone is expected, a plain zone id string (`"stock.1"`) is accepted as shorthand for `{ "zone": "stock.1" }`.

Predicates:

| Predicate | True when |
|---|---|
| `{ "all": [p, ...] }`, `{ "any": [p, ...] }`, `{ "not": p }` | Boolean logic |
| `{ "eq": [a, b] }`, `{ "neq": [a, b] }`, `{ "lt": [a, b] }`, `{ "lte": [a, b] }`, `{ "gt": [a, b] }`, `{ "gte": [a, b] }` | Comparison |
| `{ "isEmpty": <zone> }` | Zone has no cards |
| `{ "isNull": <value> }` | Value is null (for example no card at that position) |
| `{ "isSequence": { "cards": <cards>, "rankStep": -1, "suit": "SAME" } }` | Each card is `rankStep` from the one beneath it; `suit` is `SAME`, `ANY` or `ALTERNATE_COLOR` |
| `{ "allFaceUp": <cards> }` | Every card is face up |
| `{ "forAll": { "type": "tableau", "as": "z", "where": p } }` | Every zone instance of the type satisfies `p` |
| `{ "exists": { "type": "tableau", "as": "z", "where": p } }` | At least one instance satisfies `p` |
| `{ "reversesLastAction": true }` | The candidate action exactly undoes the previous action (used by hints) |

### 4.6 Setup

Setup is an ordered list of steps run once at game creation. Any step may carry a `when` predicate (usually on options).

| Step | Effect |
|---|---|
| `{ "createCards": { "cardSet": "main", "into": "stock.1", "faceUp": false } }` | Creates every card of the set into a zone |
| `{ "shuffle": { "zone": "stock.1" } }` | Fisher-Yates shuffle with the seeded generator |
| `{ "dealRows": { "from": "stock.1", "type": "tableau", "counts": [6, 6, 6, 6, 5, 5, 5, 5, 5, 5], "faceUp": false } }` | Deals one card at a time across the zone instances in index order, row by row, until each instance has received its count |
| `{ "setVar": { "name": "x", "value": <value> } }` | Sets a var |

Triggers run after setup completes (Section 4.8), which is how the top card of each column is turned face up.

### 4.7 Actions

An action template declares parameters, requirements, effects, its score delta and its speech text.

| Field | Meaning |
|---|---|
| `id` | Template id, ALL_CAPS |
| `kind` | `MOVE_CARDS`, `DEAL`, or `OTHER`; drives the generic descriptor shape (Section 9) |
| `params` | Ordered parameter list; each parameter's domain may refer to earlier parameters |
| `require` | Predicates that must all hold for a binding to be legal |
| `effects` | Ordered list of effects |
| `score` | Score delta applied when the action is taken |
| `countsAsMove` | Whether `moveCount` increments (default true) |
| `equivalence` | Declares bindings that are interchangeable (Section 9.3) |
| `speech` | Text templates (Section 4.12) |

Parameter domains:

| Domain | Values |
|---|---|
| `{ "zones": { "type": "tableau" } }` | Every instance of the zone type, in index order |
| `{ "int": { "min": <value>, "max": <value> } }` | Integers in an inclusive range |

A parameter may also declare `prune`: predicates checked as soon as that parameter is bound, so the enumerator skips the rest of a binding early. `prune` is an optimization only; every predicate in `prune` must also hold under `require` semantics.

Effects:

| Effect | Behavior |
|---|---|
| `{ "moveCards": { "from": <zone>, "count": <n>, "to": <zone> } }` | Moves the top `n` cards, preserving order and face state |
| `{ "dealRow": { "from": <zone>, "type": "tableau", "faceUp": true } }` | Deals one card to each instance of the type in index order until the source is empty or every instance has received one |
| `{ "flipTop": { "zone": <zone>, "faceUp": true } }` | Sets the top card's face state |
| `{ "moveToFirstEmpty": { "from": <zone>, "count": <n>, "type": "foundation" } }` | Moves the top `n` cards to the lowest-index empty instance of the type |
| `{ "addVar": { "name": "completedRuns", "by": 1 } }` | Changes a var |
| `{ "emit": { "event": "RUN_COMPLETED", "data": { } } }` | Emits a named event with data expressions |

The engine emits `CARDS_MOVED`, `CARDS_DEALT`, `CARD_FLIPPED` and `VAR_CHANGED` events automatically for the corresponding effects.

### 4.8 Triggers

Triggers are automatic consequences. After setup and after every action, the engine evaluates every trigger against every instance it iterates over; for each match it runs the trigger's effects. It repeats the full pass until a pass makes no change. A pass limit of 100 guards against rules that never settle; exceeding it throws `EngineInvariantError`.

```json
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
```

Triggers are evaluated in declaration order within a pass.

### 4.9 End Conditions

An ordered list of `{ "status": "WON", "when": <predicate> }`. After triggers settle, the first matching condition sets the game status. Schema version 1 supports `WON` and `LOST`. Independently, the engine reports `blocked: true` when no rule action is legal; a blocked game is not over, since the player can still undo.

### 4.10 Undo

```json
"undo": { "allowed": true, "score": -1, "refundUndoneAction": false }
```

`undo` reverts the most recent action, including every trigger that action caused. `score` is the penalty for undoing. When `refundUndoneAction` is false, the undone action's own `score` delta stays applied (its trigger score deltas, such as a completed run bonus, are reverted). Undo is unlimited back to the start of the game.

### 4.11 Hints

```json
"hints": {
  "weights": [
    { "when": <predicate>, "weight": 100 },
    { "when": { "reversesLastAction": true }, "weight": -1000 }
  ]
}
```

Each entry may name an `action` template id, in which case it applies only to that template; `when` may be the literal `true`. The hint is the legal action with the highest summed weight. Ties go to the action that appears first in `listLegalActions` order. Predicates may refer to the action's parameters.

### 4.12 Speech

Speech text is how actions and events are described on screen, spoken by Polly, and given to the action decider.

```json
"speech": {
  "zoneAliases": { "tableau": ["column", "pile", "stack"] },
  "actions": {
    "MOVE_UNIT": {
      "text": "Move {cards.lead} from {param.from} to {param.to}",
      "short": "{param.from} to {param.to}"
    }
  },
  "events": {
    "RUN_COMPLETED": "Completed a run of {data.suit}"
  }
}
```

Placeholders:

| Placeholder | Renders as |
|---|---|
| `{param.<name>}` for a zone | The zone label, for example "column 7"; an empty zone renders "empty column 7" |
| `{param.<name>}` for an integer | The number |
| `{cards.lead}` | Name of the bottom card being moved, for example "seven of hearts" |
| `{cards.count}` | Number of cards moved |
| `{target.top}` | Name of the destination's top card, or "empty" |
| `{data.<name>}` | Event data field |
| `{var.<name>}` | Var value |

`deciderGuidance` is a list of game-specific instructions the action decider adds to its game-action prompt (`action-decision.md` Section 6), for example how players refer to columns.

Card names are rendered by the engine in a fixed form ("ace of spades", "ten of hearts", "king of clubs") so every client and the decider use the same words.

## 5. Primitive Library and Versioning

Every expression, predicate, setup step and effect in Section 4 is a primitive implemented once in `game-engine/primitives/`. A rules document may only use primitives defined for its `schemaVersion`. Adding a primitive is additive and does not change `schemaVersion`. Changing the semantics of an existing primitive is forbidden; a replacement primitive gets a new name. This guarantees that a session started on any rules version replays identically forever.

## 6. Game State

`GameState` is plain JSON, persisted gzip-compressed in `GameSession.state`.

```json
{
  "engineSchemaVersion": 1,
  "gameId": "spider-solitaire",
  "rulesVersion": 1,
  "options": { "suits": 1, "dealStyle": "MICROSOFT" },
  "seed": "a3f9c1e07b2d4e6f8a1b3c5d7e9f0a2b",
  "seats": [{ "seatId": "S1" }],
  "cards": {
    "c0": { "suit": "SPADES", "rank": 1, "faceUp": false },
    "c1": { "suit": "SPADES", "rank": 2, "faceUp": false }
  },
  "zones": {
    "stock.1": ["c88", "c12", "c40"],
    "tableau.1": ["c3", "c71", "c19", "c55", "c90", "c8"],
    "foundation.1": []
  },
  "vars": { "score": 465, "moveCount": 33, "undoCount": 2, "completedRuns": 0 },
  "history": [
    "MOVE_UNIT|from=tableau.4|depth=1|to=tableau.2",
    "DEAL_ROW"
  ],
  "scoreCarry": -4,
  "status": "IN_PROGRESS",
  "version": 37
}
```

(`cards` and `zones` are abbreviated here; a Spider Solitaire state holds all 104 cards.)

- `history` lists the action ids applied since setup, in order, excluding undone actions.
- `scoreCarry` is the accumulated score adjustment from undos (Section 4.10) that replay alone does not reproduce.
- `version` increments on every applied action and every undo.
- The seed is 128 bits, generated by the session service with `crypto.randomBytes`. The engine's generator is xoshiro128** seeded from it.

## 7. Interpreter Behavior

### 7.1 Create

`createGame` resolves options (filling defaults, rejecting invalid values), creates cards, runs setup steps, runs triggers to a fixed point, evaluates end conditions, and returns state with `version` 0.

### 7.2 Enumerate

`listLegalActions` walks every action template in declaration order. For each, it binds parameters in declared order, iterating each domain, applying `prune` after each binding, and evaluating `require` on the full binding. The result is ordered by template order, then by parameter values in domain order. This order is stable and is the order clients and the decider see.

### 7.3 Apply

`applyAction(state, seatId, actionId)`:

1. Confirms the game is `IN_PROGRESS` and the seat exists.
2. Parses the action id and re-runs that template's `require` against the binding. If the action is not legal, throws `IllegalActionError`. Re-checking only the one binding keeps apply fast.
3. Runs the effects, applies `score`, increments `moveCount` when `countsAsMove`.
4. Runs triggers to a fixed point, applying their score deltas.
5. Evaluates end conditions.
6. Appends the action id to `history`, increments `version`.
7. Checks invariants: total card count is unchanged and every card is in exactly one zone. A violation throws `EngineInvariantError`.
8. Returns the new state (the input is never mutated) and the events.

### 7.4 Undo

`undo(state, seatId)` rebuilds the state by running setup from the seed and replaying `history` without its last entry, then applies the undo penalty to `scoreCarry`, increments `undoCount` and `version`. Replay makes undo exact, including reverting trigger effects and re-hiding cards. A 300 action Spider Solitaire replay completes in under 20 ms.

### 7.5 Determinism

The engine never calls `Math.random`, `Date`, or any I/O. A test enforces that replaying `history` from the seed reproduces the stored state exactly for every game in the test corpus.

## 8. Public Interface

The engine exports exactly this surface from `game-engine/index.ts`. Nothing else is importable from outside the directory (Section 16).

```ts
export function validateRules(doc: unknown): RulesValidationResult;
export function compileRules(doc: RulesDocument): CompiledGame;

export interface CompiledGame {
  readonly gameId: string;
  readonly rulesVersion: number;
  readonly catalogEntry: GameCatalogEntry;

  createGame(input: { options: Record<string, unknown>; seed: string; seats: SeatId[] }): GameState;
  getView(state: GameState, seatId: SeatId): GameView;
  listLegalActions(state: GameState, seatId: SeatId): LegalAction[];
  validateAction(state: GameState, seatId: SeatId, actionId: string): ActionValidation;
  applyAction(state: GameState, seatId: SeatId, actionId: string): ApplyResult;
  undo(state: GameState, seatId: SeatId): ApplyResult;
  getHint(state: GameState, seatId: SeatId): LegalAction | null;
  getStatus(state: GameState): GameStatusInfo;
}

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
  status: GameStatusInfo;
}

export interface GameStatusInfo {
  status: "IN_PROGRESS" | "WON" | "LOST";
  blocked: boolean;
  canUndo: boolean;
}

export type ActionValidation =
  | { valid: true; action: LegalAction }
  | { valid: false; reason: "UNKNOWN_ACTION" | "NOT_LEGAL" | "GAME_OVER" | "NOT_SEATED" };
```

Errors thrown: `RulesValidationError`, `IllegalActionError`, `UndoUnavailableError`, `EngineInvariantError`, and `InvalidGameInputError` (unknown or invalid options, a malformed seed, or a wrong seat count passed to `createGame`). Each has a stable `.name`.

## 9. Legal Actions

### 9.1 Action Ids

An action id is the template id followed by each bound parameter in declared order: `MOVE_UNIT|from=tableau.3|depth=2|to=tableau.7`. A template with no parameters has the bare template id: `DEAL_ROW`. Ids are deterministic and parseable, and contain no hidden information.

### 9.2 Legal Action Shape

```ts
interface LegalAction {
  actionId: string;
  templateId: string;
  params: Record<string, string | number>;
  descriptor: ActionDescriptor;
  text: string;           /* "Move seven of hearts from column 3 to column 7" */
  shortText: string;      /* "column 3 to column 7" */
  equivalenceKey?: string;
}

type ActionDescriptor =
  | { kind: "MOVE_CARDS"; cards: CardFace[]; from: ZoneRef; to: ZoneRef & { topCard: CardFace | null } }
  | { kind: "DEAL"; from: ZoneRef; cardCount: number }
  | { kind: "OTHER" };

interface CardFace { cardId: string; suit: Suit; rank: number; name: string }
interface ZoneRef { zoneId: string; type: string; index: number; label: string }
```

Descriptors reference only face-up cards. They let the web client highlight the source cards and destinations of a selected card without computing any rule, and they give the action decider structured facts to match speech against.

### 9.3 Equivalence

Some legal actions are interchangeable from the player's point of view. In Spider Solitaire, moving a unit to empty column 4 or to empty column 6 is the same choice. A template declares this:

```json
"equivalence": { "param": "to", "when": { "isEmpty": { "param": "to" } } }
```

Matching actions get the same `equivalenceKey` (the action id with that parameter replaced by `*`). Consumers treat a group as one choice and use its first member (lowest index) unless the player named a specific zone.

## 10. Views

`getView` returns everything a client renders, with hidden information removed:

```ts
interface GameView {
  gameId: string;
  rulesVersion: number;
  options: Record<string, unknown>;
  status: GameStatusInfo;
  vars: Record<string, number>;
  zones: Array<{
    zoneId: string;
    type: string;
    index: number;
    label: string;
    layout: string;
    region: string;
    count: number;
    cards: Array<CardFace & { faceUp: true } | { faceUp: false }> | null;  /* null for COUNT_ONLY zones */
  }>;
}
```

Face-down cards carry no id, suit or rank, because card ids are assigned in creation order and would reveal identity.

## 11. Game Session Service and HTTP API

The game session service (`backend/src/service/gameSession/`) is the only caller of the engine for session play. It loads and saves `GameSession` items, holds seat checks, updates `SeatAssignment` and `PlayerStats`, and writes metric counters. Starting a session writes the session and its seat in one transaction; ending one (a win or an abandon) writes the session, its seats and the seat holders' `PlayerStats` in one transaction (`data-model.md` Sections 6 to 8). A move that leaves the session in progress writes only the session. The action decider calls this service, never the engine directly, for validation and application, so every game mutation goes through one code path.

All routes are on the All Play HTTP API, authorized with IAM (`authn-authz.md` Section 4). The caller's `playerId` comes from the request context, never from the body.

| Method and path | Purpose |
|---|---|
| `GET /v1/games` | Catalog: every playable game with its options |
| `GET /v1/games/{gameId}` | One catalog entry |
| `POST /v1/sessions` | Start a game. Body `{ gameId, options? }`. Omitted options fall back to the player's `lastOptions`, then rule defaults. Any `IN_PROGRESS` session of the same game for this player becomes `ABANDONED` |
| `GET /v1/sessions/current?gameId=` | The player's in-progress session for a game, or 404. Powers direct navigation such as `/spider` |
| `GET /v1/sessions/{sessionId}` | Session envelope |
| `POST /v1/sessions/{sessionId}/actions` | Body `{ actionId, expectedVersion, source, decisionId? }`. Applies a legal action |
| `POST /v1/sessions/{sessionId}/undo` | Body `{ expectedVersion, source, decisionId? }` |
| `GET /v1/sessions/{sessionId}/hint` | `{ action: LegalAction | null, text }` |
| `POST /v1/sessions/{sessionId}/abandon` | Body `{ expectedVersion }` |

`source` is `POINTER`, `KEYBOARD` or `VOICE`.

Every route that returns a session returns the same envelope:

```json
{
  "session": {
    "sessionId": "01JEX4Q8N6W2D3K5T7V9B1C3E5",
    "gameId": "spider-solitaire",
    "status": "IN_PROGRESS",
    "version": 38,
    "options": { "suits": 1, "dealStyle": "MICROSOFT" },
    "summary": { "score": 464, "moveCount": 34, "undoCount": 2, "completedRuns": 0, "stockDealsRemaining": 4 }
  },
  "view": { "zones": [], "vars": {}, "status": { "status": "IN_PROGRESS", "blocked": false, "canUndo": true } },
  "legalActions": [],
  "metaActions": [
    { "id": "UNDO", "available": true },
    { "id": "HINT", "available": true }
  ],
  "events": [
    { "type": "CARDS_MOVED", "data": { "from": "tableau.4", "to": "tableau.2", "cardIds": ["c17"] } },
    { "type": "CARD_FLIPPED", "data": { "zone": "tableau.4", "cardId": "c61" }, "speech": null }
  ]
}
```

Error responses:

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body fails its zod schema |
| 403 | `NOT_SEATED` | Caller holds no seat in the session |
| 404 | `NOT_FOUND` | Unknown game or session |
| 409 | `VERSION_CONFLICT` | `expectedVersion` is stale; the body carries the current envelope so the client re-renders without another request |
| 422 | `ILLEGAL_ACTION` | Action is not legal in the current state |
| 422 | `GAME_OVER` | Session is not `IN_PROGRESS` |

Performance target: server time for `POST .../actions` under 150 ms at p50 and 300 ms at p95 on a warm Lambda.

### 11.1 Session Persistence

The game session service depends only on the `GameSessionDao` interface (`backend/src/dao/gameSession/`), which has two implementations with identical behavior:

1. `InMemoryGameSessionDao` keeps sessions in a map, enforces the same `version` condition as DynamoDB, and stores the engine state through the same codec. It backs unit and functional tests and local runs.
2. `DynamoGameSessionDao` stores `GameSession` items (`data-model.md` Section 6) with conditional writes. It is built in DM-3.

A shared DAO contract test suite runs against both implementations, so the in-memory DAO cannot drift from DynamoDB.

### 11.2 Functional Tests

Functional tests (`backend/tests/functional/`) play complete games through the game session service, exactly as the HTTP API will, on the in-memory DAO. Each scenario fixes the 128-bit seed, which fixes the shuffle and therefore the deal, and lists the player's actions; the scenario asserts the outcome. Spider Solitaire scenarios cover at least a win (all eight runs completed, status `WON`) and a loss (the player's choices reach a dead end: stock empty, no legal action, status still `IN_PROGRESS` with `blocked: true`; the player then abandons, which `PlayerStats` counts as a loss). Winning lines are found by a test-only solver (`backend/tests/functional/solver.ts`) and recorded in the scenario, so the test replays a fixed line rather than searching. The same scenarios run against `DynamoGameSessionDao` on the AWS Emulator once DM-3 exists.

## 12. Pointer and Keyboard Play

Clients implement tap-to-select and drag-and-drop by filtering `legalActions` from the envelope:

1. Selecting a face-up card selects the unit from that card to the top of its zone. The client finds the legal actions whose `descriptor.from.zoneId` and `cards` match, and highlights their `to` zones.
2. Tapping a highlighted zone, or dropping on it, sends that action's `actionId`.
3. Dropping on a zone with no matching legal action returns the cards to place with a short shake animation and no request.

The client never decides legality; it only matches against the server's list.

## 13. Rules Validation

`validateRules` runs three stages and returns a report listing every problem. Stages 1 and 2 always run; stage 3 runs when requested with `validateRules(doc, { simulate })`, because it takes minutes:

1. Schema: the zod `RulesDocumentSchema`.
2. Static checks: every referenced zone type, param, var, option, card set, event and speech placeholder exists; parameter domains reference only earlier parameters; option `switch` cases cover every option value.
3. Simulation: for 50 seeds per option combination, create the game, then play 500 random legal actions with random undos. Every step must satisfy the invariants of Section 7.3, triggers must settle within the pass limit, and replay from the seed must reproduce the final state.

Core rules documents run this validation in unit tests. Community rules documents run it before they can be published.

## 14. Testing

1. Unit tests for every primitive, with 95%+ line and branch coverage for `game-engine/`.
2. Golden games: fixed seeds with recorded action sequences and expected final states, checked into `backend/tests/game-engine/golden/`.
3. Property tests (fast-check): for random seeds and random legal action sequences, card conservation holds, `listLegalActions` never returns an action `applyAction` rejects, `applyAction` rejects every action id not in the list, and `undo` after `applyAction` restores the previous view exactly.
4. Redaction tests: no view, legal action or event for any state contains the id, suit or rank of a face-down card or any stock card.
5. Performance tests: `listLegalActions` for Spider Solitaire under 5 ms and `applyAction` under 5 ms at p99 on the CI runner.
6. Integration tests (API): the session routes in Section 11, run against the Test stage by the pipeline.

## 15. Multiplayer and Non-Card Seams

1. State and actions carry `seatId`. Schema version 1 only allows `players.max = 1`; a later schema version adds turn order, per-seat visibility and seat-scoped actions without changing the interface in Section 8.
2. The zone abstraction (ordered containers of components) also models board cells. Non-card components (pieces, dice, tokens) are added as new component kinds and primitives in a later schema version.

## 16. Code Layout and Isolation

```
backend/src/game-engine/
  index.ts          public surface (Section 8), the only importable file
  rules/            zod schema, static checks, compiler
  primitives/       expressions, predicates, setup steps, effects
  interpreter/      create, enumerate, apply, triggers, undo, hints
  view/             redaction and descriptors
  speech/           text templates and card names
  random/           seeded xoshiro128** and shuffle
  errors.ts
backend/src/game-catalog/
  spider-solitaire/rules.v1.json
  index.ts          BundledRulesRepository
backend/src/service/gameSession/
```

Lint rules (ESLint `no-restricted-imports` and a custom boundary rule):

1. Files under `game-engine/` may import only other `game-engine/` files and `zod`.
2. Files outside `game-engine/` may import only `game-engine/index.ts`.
3. `game-engine/` may not reference `Math.random`, `Date`, `process`, `console`, or any `node:` module.

## 17. Implementation Legs

Each leg is one commit, built in execution phase 5 (Game Engine) unless noted.

| Leg | Scope |
|---|---|
| GE-1 | `game-engine/` skeleton, public types, error classes, seeded random and shuffle with tests, isolation lint rules |
| GE-2 | Rules schema (zod) and static checks, with a fixture rules document covering every primitive |
| GE-3 | Expression and predicate primitives with unit tests |
| GE-4 | Setup steps, `createGame`, triggers fixed-point loop, end conditions, invariants |
| GE-5 | Parameter enumeration, `listLegalActions`, action ids, `validateAction`, `applyAction` |
| GE-6 | Undo by replay, `scoreCarry`, hints, equivalence keys |
| GE-7 | Views, redaction, descriptors, speech templates and card names; redaction tests |
| GE-8 | Simulation validator (Section 13) and property tests |
| GE-9 | `game-catalog` with `BundledRulesRepository` and a minimal test game (a 20-card toy game) that exercises the full interface |
| GE-10 | Game session service on the `GameSessionDao` interface with `InMemoryGameSessionDao` and the DAO contract tests (Section 11.1) |
| GE-12 | Functional tests: full Spider Solitaire playthroughs from fixed seeds through the session service, including a win and a dead-end loss (Section 11.2) |
| GE-13 | Session routes and controllers, `SeatAssignment` and `PlayerStats` writes |
| GE-11 | API integration tests for the session routes against the Test stage, plus performance tests |

Spider Solitaire itself lands in the legs of `spider-solitaire.md`.

## Addendum A: Command-Line Client

A terminal client plays Spider Solitaire on the engine, entirely in memory, so the engine can be played and checked by hand before any web or API work. It is a client like the web app: it renders the view and the legal action list and sends action ids, and it never decides legality itself.

### A.1 Install and Start

The client is the npm package `game-engine-cli`, whose manifest is `backend/cli/package.json` and whose single bundled file is built from `backend/src/cli/` by `npm run build:cli` in `backend/`. From the repository root:

```
npm run cli:install
game-engine-cli start --spider
```

`cli:install` installs the backend's dependencies, builds the bundle, and installs the package globally from `backend/cli`. `npm pack` in `backend/cli` produces a tarball that installs anywhere with `npm install -g <tarball>`. The package is not published to the npm registry; publishing is a separate decision.

`game-engine-cli start --spider` starts a one-suit Spider Solitaire game with the standard (Microsoft) deal, the one option the client offers. `--seed <32 hex characters>` replays a specific deal. `game-engine-cli --help` prints usage.

### A.2 Architecture

1. The client builds the game session service (Section 11) on `InMemoryGameSessionDao` and the bundled rules repository, and plays every command through it, exactly as the HTTP API does. State lasts until the client exits.
2. Every client function of the engine is a command: start a new game, view the board, list legal moves, apply a move, deal, hint, undo, and abandon.
3. Output is plain text with no color codes, emoji or icons. Cards print as rank and suit letter (`AS`, `10S`, `KS`); face-down cards print as `--`.

### A.3 Commands

| Command | Effect |
|---|---|
| `board`, `b` | Prints the board: columns 1 to 10 side by side, completed runs, stock size, deals left, score and moves |
| `moves`, `m` | Lists legal actions numbered from 1, with their engine text |
| `<n>` or `move <n>` | Plays legal action number `n` from the latest list |
| `<from> <to>` or `move <from> <to>` | Plays the move from column `from` to column `to`. A non-empty target admits one depth; for an empty target the largest movable unit is moved |
| `move <actionId>` | Plays an exact action id |
| `deal`, `d` | Deals a row from the stock |
| `hint`, `h` | Shows the engine's hint |
| `undo`, `u` | Undoes the last action |
| `new` | Abandons the current game and starts a new one |
| `help`, `?` | Lists commands |
| `quit`, `q` | Exits |

After every action the client prints the event speech (for example "Completed a run of spades") and the board. Illegal or unknown input prints the reason and changes nothing. A win or a dead end is announced, with the commands still available.

### A.4 Legs

| Leg | Scope |
|---|---|
| CLI-1 | This addendum |
| CLI-2 | `backend/src/cli/` (argument parsing, board rendering, command loop), `backend/cli/package.json`, `build:cli` and `cli:install` scripts, unit tests driving the loop with scripted input |

## Appendix: Implementation Progress

Status as of 2026-11-20: closed. The in-memory game engine, Spider Solitaire and the command-line client are complete and accepted by the owner. Built ahead of phase 4 by the owner's direction. The open legs below move to later work: GE-13 and GE-11 with `local-development.md` (LD-2) and the guest Identity Pool (AA-4), and DM-3 when DynamoDB tables are built.

| Leg | Status | Notes |
|---|---|---|
| GE-1 | Done | Public types, errors (adds `InvalidGameInputError`), xoshiro128** and Fisher-Yates shuffle, isolation lint rules |
| GE-2 | Done | `RulesDocumentSchema` (zod) and static checks, including missing zones, speech placeholders and derived vars |
| GE-3 | Done | Every expression and predicate primitive in Section 4.5, plus `div` |
| GE-4 | Done | Setup steps, `createGame`, triggers to a fixed point with the pass limit, end conditions, card conservation |
| GE-5 | Done | Enumeration with prune, action ids, `validateAction`, `applyAction` |
| GE-6 | Done | Undo by replay with `scoreCarry`, hints with `reversesLastAction`, equivalence keys |
| GE-7 | Done | Views with redaction and derived vars (Section 4.2.1), descriptors, speech templates and card names |
| GE-8 | Done | `validateRules(doc, { simulate })` runs stage 3 (`rules/simulate.ts`). Property tests (fast-check): listed actions validate, every other Spider id is rejected, undo restores the view, and nothing hidden leaks. The full-size run (50 seeds, 500 actions, every option combination, about 3.5 minutes) is `npm run test:simulation` in GitHub Actions |
| GE-9 | Done | `createBundledRulesRepository` in `game-catalog/`; the toy game in `backend/tests/game-engine/toyRules.ts` uses every primitive |
| GE-10 | Done | `createGameSessionService` on `GameSessionDao`, `createInMemoryGameSessionDao`, gzip state codec, ULIDs, shared DAO contract tests; the summary holds vars and derived vars |
| GE-11 | Open | Needs GE-13; runs against the local server (`local-development.md`) and the Test stage |
| GE-12 | Done | `backend/tests/functional/`: one-suit win, dead-end loss and abandon, undo out of the dead end, stale version conflict, Hoyle final deal, and the two- and four-suit golden wins through the session service |
| GE-13 | Partial | The session routes and controllers run on the local server since LD-2. The transactional `SeatAssignment` and `PlayerStats` writes and the deployed `AllPlay-GameApi-<Stage>` come with DM-3 and CDK-8 |

Spider legs SP-1 to SP-5 are done:

- `rules.v1.json` adds the derived var `stockDealsRemaining`.
- Hint and speech tests are in place, along with golden games for one, two and four suits in `backend/tests/game-engine/golden/`. Each golden game is replayed and its final state hash checked.
- The simulation covers every option combination.

The golden lines are found by test-only solvers (`tests/functional/solver.ts`): hint following, depth-first search, and a deal-by-deal best-first search. `npx tsx tests/functional/recordScenarios.ts` regenerates them.

The command-line client (Addendum A, CLI-1 and CLI-2) is done: `npm run cli:install`, then `game-engine-cli start --spider`.

Remaining outside the in-memory engine: DM-3 (`DynamoGameSessionDao`, which must pass `backend/tests/dao/gameSession/gameSessionDaoContract.ts`), GE-13 and GE-11.

Known gap: engine `LOST` maps to session status `ABANDONED`, since the session status set has no `LOST`. No core game reaches `LOST` today.

Acceptance evidence (2026-11-20, commit `a94c253`):

- 182 backend tests pass, with 99.6% lines and 98.8% branches.
- GitHub Actions is green, including the full-size rules simulation.
- The golden games replay exactly for one, two and four suits.
- The installed `game-engine-cli` plays the recorded one-suit line to a win: 108 moves, 8 runs, score 1192. It also refuses illegal moves, undoes, and reports the dead end after dealing the whole stock early.
