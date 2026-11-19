import { EngineInvariantError } from "../errors";
import type { Effect, Expr } from "../rules/schema";
import type { GameEvent, GameState } from "../types";
import { evaluate, intValue, pileOf, zoneOf, type EvalContext, type Value } from "./expressions";
import { zonesOfType } from "./layout";

/** Effects mutate `state` in place; the interpreter hands them a private working copy. */
export interface MutationContext extends EvalContext {
  events: GameEvent[];
}

function event(ctx: MutationContext, type: string, data: Record<string, unknown>): void {
  ctx.events.push({ type, data, speech: null });
}

/** Ids of the face-up cards among `cardIds`; face-down identities never appear in events. */
const visible = (state: GameState, cardIds: string[]): string[] =>
  cardIds.filter((id) => state.cards[id]?.faceUp === true);

function moveTop(ctx: MutationContext, from: string, to: string, count: number | null): void {
  const source = pileOf(ctx.state, from);
  if (count === null || count < 1 || count > source.length) {
    throw new EngineInvariantError(`Cannot move ${String(count)} cards from ${from}`);
  }
  const moved = source.splice(source.length - count, count);
  pileOf(ctx.state, to).push(...moved);
  event(ctx, "CARDS_MOVED", { from, to, count, cardIds: visible(ctx.state, moved) });
}

/** Changes a var and records VAR_CHANGED; a zero delta changes nothing. */
export function changeVar(ctx: MutationContext, name: string, delta: number): void {
  if (delta === 0) return;
  const value = (ctx.state.vars[name] as number) + delta;
  ctx.state.vars[name] = value;
  event(ctx, "VAR_CHANGED", { name, value, delta });
}

function plain(value: Value): unknown {
  if (Array.isArray(value)) return value.map((card) => card.cardId);
  if (typeof value === "object" && value !== null) return value.cardId;
  return value;
}

function emitData(data: Record<string, Expr>, ctx: MutationContext): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, expr]) => [key, plain(evaluate(expr, ctx))]),
  );
}

/** Runs one effect (game-engine.md section 4.7). */
export function runEffect(effect: Effect, ctx: MutationContext): void {
  if ("moveCards" in effect) {
    const spec = effect.moveCards;
    moveTop(ctx, zoneOf(spec.from, ctx), zoneOf(spec.to, ctx), intValue(spec.count, ctx));
  } else if ("dealRow" in effect) {
    const spec = effect.dealRow;
    const from = zoneOf(spec.from, ctx);
    const source = pileOf(ctx.state, from);
    const dealt: string[] = [];
    const to: string[] = [];
    for (const zoneId of zonesOfType(ctx.layout, spec.type)) {
      const cardId = source.pop();
      if (cardId === undefined) break;
      (ctx.state.cards[cardId] as { faceUp: boolean }).faceUp = spec.faceUp;
      pileOf(ctx.state, zoneId).push(cardId);
      dealt.push(cardId);
      to.push(zoneId);
    }
    event(ctx, "CARDS_DEALT", {
      from,
      to,
      count: dealt.length,
      cardIds: visible(ctx.state, dealt),
    });
  } else if ("flipTop" in effect) {
    const zone = zoneOf(effect.flipTop.zone, ctx);
    const top = pileOf(ctx.state, zone).at(-1);
    if (top === undefined) throw new EngineInvariantError(`Cannot flip the top of empty ${zone}`);
    const card = ctx.state.cards[top] as { faceUp: boolean };
    card.faceUp = effect.flipTop.faceUp;
    event(ctx, "CARD_FLIPPED", {
      zone,
      faceUp: card.faceUp,
      ...(card.faceUp ? { cardId: top } : {}),
    });
  } else if ("moveToFirstEmpty" in effect) {
    const spec = effect.moveToFirstEmpty;
    const target = zonesOfType(ctx.layout, spec.type).find(
      (zoneId) => pileOf(ctx.state, zoneId).length === 0,
    );
    if (target === undefined) throw new EngineInvariantError(`No empty ${spec.type} zone`);
    moveTop(ctx, zoneOf(spec.from, ctx), target, intValue(spec.count, ctx));
  } else if ("addVar" in effect) {
    changeVar(ctx, effect.addVar.name, intValue(effect.addVar.by, ctx) ?? 0);
  } else {
    event(ctx, effect.emit.event, emitData(effect.emit.data, ctx));
  }
}
