import { EngineInvariantError } from "../errors";
import type { Expr } from "../rules/schema";
import type { CardState, GameState, Suit } from "../types";
import { zonesOfType, type GameLayout } from "./layout";

/** A card reference produced by `card` and `cards` (game-engine.md section 4.5). */
export interface CardRef {
  cardId: string;
}

export type Value = number | string | boolean | null | CardRef | CardRef[];

export interface EvalContext {
  state: GameState;
  layout: GameLayout;
  params: Readonly<Record<string, string | number>>;
  refs: Readonly<Record<string, string>>;
  /** Supplied only while scoring hints; answers whether the bound action undoes the previous one. */
  reversesLastAction?: () => boolean;
}

export const COLOR: Record<Suit, "BLACK" | "RED"> = {
  SPADES: "BLACK",
  CLUBS: "BLACK",
  HEARTS: "RED",
  DIAMONDS: "RED",
};

type SuitRule = "SAME" | "ANY" | "ALTERNATE_COLOR";
type Operands = Record<string, Expr>;

const isCardRef = (value: Value): value is CardRef =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const num = (value: Value): number | null => (typeof value === "number" ? value : null);

/** The cards of a zone; every zone id the evaluator produces names an existing zone. */
export function pileOf(state: GameState, zoneId: string): string[] {
  return state.zones[zoneId] as string[];
}

function fail(message: string): never {
  throw new EngineInvariantError(message);
}

function operands(expr: Expr): Operands {
  return typeof expr === "object" && expr !== null && !Array.isArray(expr) ? expr : {};
}

/** Resolves an expression that must name a zone; a plain zone id string is accepted. */
export function zoneOf(expr: Expr, ctx: EvalContext): string {
  const value = evaluate(expr, ctx);
  if (typeof value === "string" && ctx.layout.zoneIds.has(value)) return value;
  return fail(`Expected a zone, got ${JSON.stringify(value)}`);
}

function cardsOf(value: Value): CardRef[] {
  if (Array.isArray(value)) return value;
  return isCardRef(value) ? [value] : [];
}

function cardAt(zone: string, fromTop: number | null, state: GameState): CardRef | null {
  const pile = pileOf(state, zone);
  if (fromTop === null || fromTop < 1 || fromTop > pile.length) return null;
  return { cardId: pile[pile.length - fromTop] as string };
}

function cardProperty(
  value: Value,
  property: "rank" | "suit" | "color" | "faceUp",
  state: GameState,
): Value {
  if (!isCardRef(value)) return null;
  const card = state.cards[value.cardId];
  if (card === undefined) return fail(`Unknown card ${value.cardId}`);
  if (property === "color") return COLOR[card.suit];
  return card[property];
}

/** True when `above` sits `rankStep` from `beneath` and honors the suit rule. */
function follows(
  beneath: string,
  above: string,
  rankStep: number,
  suit: SuitRule,
  state: GameState,
): boolean {
  const low = state.cards[beneath] as CardState;
  const high = state.cards[above] as CardState;
  if (high.rank !== low.rank + rankStep) return false;
  if (suit === "SAME") return high.suit === low.suit;
  if (suit === "ALTERNATE_COLOR") return COLOR[high.suit] !== COLOR[low.suit];
  return true;
}

function runLength(spec: Operands, ctx: EvalContext): number {
  const pile = pileOf(ctx.state, zoneOf(spec["zone"] as Expr, ctx));
  const rankStep = num(evaluate(spec["rankStep"] ?? -1, ctx)) ?? -1;
  const suit = (spec["suit"] ?? "ANY") as SuitRule;
  const faceUpOnly = spec["faceUpOnly"] === true;
  const faceUp = (id: string): boolean => !faceUpOnly || ctx.state.cards[id]?.faceUp === true;
  let length = 0;
  for (let i = pile.length - 1; i >= 0; i -= 1) {
    const id = pile[i] as string;
    if (!faceUp(id)) break;
    if (length > 0 && !follows(id, pile[i + 1] as string, rankStep, suit, ctx.state)) break;
    length += 1;
  }
  return length;
}

function isSequence(spec: Operands, ctx: EvalContext): boolean {
  const cards = cardsOf(evaluate(spec["cards"] ?? null, ctx));
  const rankStep = num(evaluate(spec["rankStep"] ?? -1, ctx)) ?? -1;
  const suit = (spec["suit"] ?? "ANY") as SuitRule;
  return cards.every(
    (card, i) =>
      i === 0 || follows((cards[i - 1] as CardRef).cardId, card.cardId, rankStep, suit, ctx.state),
  );
}

/** Each zone instance of a type, with the predicate evaluated for it under the `as` reference. */
function eachZone(spec: Operands, ctx: EvalContext): boolean[] {
  const type = spec["type"] as string;
  const as = spec["as"] as string;
  return zonesOfType(ctx.layout, type).map((zoneId) =>
    truthy(evaluate(spec["where"] ?? true, { ...ctx, refs: { ...ctx.refs, [as]: zoneId } })),
  );
}

const truthy = (value: Value): boolean => value === true;

function same(a: Value, b: Value): boolean {
  if (isCardRef(a) && isCardRef(b)) return a.cardId === b.cardId;
  return a === b;
}

function arithmetic(op: string, args: Value[]): Value {
  const [a, b] = args.map(num);
  if (a === null || b === null || a === undefined || b === undefined) return null;
  if (op === "add") return a + b;
  if (op === "sub") return a - b;
  if (op === "min") return Math.min(a, b);
  if (op === "div") return b === 0 ? null : Math.floor(a / b);
  return Math.max(a, b);
}

function compare(op: string, args: Value[]): boolean {
  const [a, b] = args.map(num);
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (op === "lt") return a < b;
  if (op === "lte") return a <= b;
  if (op === "gt") return a > b;
  return a >= b;
}

const list = (expr: Expr | undefined): Expr[] => (Array.isArray(expr) ? expr : []);

/** Evaluates a value expression or predicate (game-engine.md section 4.5). */
export function evaluate(expr: Expr, ctx: EvalContext): Value {
  if (expr === null || typeof expr !== "object") return expr;
  if (Array.isArray(expr)) return fail("An array is not an expression");
  const ops = operands(expr);
  if ("switch" in ops) {
    const key = JSON.stringify(evaluate(ops["switch"], ctx)).replace(/^"|"$/g, "");
    const cases = operands(ops["cases"] ?? null);
    const chosen = key in cases ? cases[key] : ops["default"];
    return chosen === undefined ? null : evaluate(chosen, ctx);
  }
  const [op] = Object.keys(ops);
  const arg = ops[op as string] ?? null;
  const args = (): Value[] => list(arg).map((item) => evaluate(item, ctx));
  switch (op) {
    case "param":
      return ctx.params[arg as string] ?? fail(`Unbound param ${JSON.stringify(arg)}`);
    case "option":
      return ctx.state.options[arg as string] ?? null;
    case "var":
      return ctx.state.vars[arg as string] ?? null;
    case "ref":
      return ctx.refs[arg as string] ?? fail(`Unbound ref ${JSON.stringify(arg)}`);
    case "zone":
      return zoneOf(arg, ctx);
    case "count":
      return pileOf(ctx.state, zoneOf(arg, ctx)).length;
    case "card": {
      const spec = operands(arg);
      return cardAt(
        zoneOf(spec["zone"] as Expr, ctx),
        num(evaluate(spec["fromTop"] ?? 1, ctx)),
        ctx.state,
      );
    }
    case "cards": {
      const spec = operands(arg);
      const pile = pileOf(ctx.state, zoneOf(spec["zone"] as Expr, ctx));
      const n = num(evaluate(spec["fromTop"] ?? null, ctx)) ?? 0;
      return pile.slice(Math.max(0, pile.length - n)).map((cardId) => ({ cardId }));
    }
    case "rank":
    case "suit":
    case "color":
    case "faceUp":
      return cardProperty(evaluate(arg, ctx), op, ctx.state);
    case "runLength":
      return runLength(operands(arg), ctx);
    case "countZones":
      return eachZone(operands(arg), ctx).filter(Boolean).length;
    case "add":
    case "sub":
    case "min":
    case "max":
    case "div":
      return arithmetic(op, args());
    case "all":
      return list(arg).every((item) => truthy(evaluate(item, ctx)));
    case "any":
      return list(arg).some((item) => truthy(evaluate(item, ctx)));
    case "not":
      return !truthy(evaluate(arg, ctx));
    case "eq":
    case "neq": {
      const [a = null, b = null] = args();
      return same(a, b) === (op === "eq");
    }
    case "lt":
    case "lte":
    case "gt":
    case "gte":
      return compare(op, args());
    case "isEmpty":
      return pileOf(ctx.state, zoneOf(arg, ctx)).length === 0;
    case "isNull":
      return evaluate(arg, ctx) === null;
    case "isSequence":
      return isSequence(operands(arg), ctx);
    case "allFaceUp":
      return cardsOf(evaluate(arg, ctx)).every(
        (card) => ctx.state.cards[card.cardId]?.faceUp === true,
      );
    case "forAll":
      return eachZone(operands(arg), ctx).every(Boolean);
    case "exists":
      return eachZone(operands(arg), ctx).some(Boolean);
    case "reversesLastAction":
      return ctx.reversesLastAction?.() ?? false;
    default:
      return fail(`Unknown expression operator ${String(op)}`);
  }
}

/** Evaluates a predicate; anything but `true` is false. */
export function holds(expr: Expr, ctx: EvalContext): boolean {
  return truthy(evaluate(expr, ctx));
}

/** Evaluates an expression that must produce an integer, or null. */
export function intValue(expr: Expr, ctx: EvalContext): number | null {
  return num(evaluate(expr, ctx));
}
