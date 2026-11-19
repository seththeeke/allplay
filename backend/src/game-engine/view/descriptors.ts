import { intValue, zoneOf, type EvalContext } from "../primitives/expressions";
import type { ActionTemplate } from "../rules/schema";
import { cardFace } from "../speech/cards";
import type { ActionDescriptor, CardFace, GameState, ZoneRef } from "../types";

function faceUpFace(state: GameState, cardId: string | undefined): CardFace | null {
  const card = cardId === undefined ? undefined : state.cards[cardId];
  return card?.faceUp === true && cardId !== undefined ? cardFace(cardId, card) : null;
}

function ref(ctx: EvalContext, zoneId: string): ZoneRef {
  return ctx.layout.refs.get(zoneId) as ZoneRef;
}

/**
 * Generic descriptor for a bound action (game-engine.md section 9.2), read
 * from the template's first card effect. Only face-up cards are described.
 */
export function describeAction(template: ActionTemplate, ctx: EvalContext): ActionDescriptor {
  if (template.kind === "MOVE_CARDS") {
    const move = template.effects.find((effect) => "moveCards" in effect);
    if (move !== undefined && "moveCards" in move) {
      const from = zoneOf(move.moveCards.from, ctx);
      const to = zoneOf(move.moveCards.to, ctx);
      const count = intValue(move.moveCards.count, ctx) ?? 0;
      const source = ctx.state.zones[from] ?? [];
      const cards = source
        .slice(source.length - count)
        .map((cardId) => faceUpFace(ctx.state, cardId))
        .filter((face): face is CardFace => face !== null);
      return {
        kind: "MOVE_CARDS",
        cards,
        from: ref(ctx, from),
        to: { ...ref(ctx, to), topCard: faceUpFace(ctx.state, ctx.state.zones[to]?.at(-1)) },
      };
    }
  }
  if (template.kind === "DEAL") {
    const deal = template.effects.find((effect) => "dealRow" in effect);
    if (deal !== undefined && "dealRow" in deal) {
      const from = zoneOf(deal.dealRow.from, ctx);
      const targets = ctx.layout.zoneIdsByType.get(deal.dealRow.type)?.length ?? 0;
      return {
        kind: "DEAL",
        from: ref(ctx, from),
        cardCount: Math.min((ctx.state.zones[from] ?? []).length, targets),
      };
    }
  }
  return { kind: "OTHER" };
}
