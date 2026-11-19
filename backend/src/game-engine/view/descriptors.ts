import { intValue, pileOf, zoneOf, type EvalContext } from "../primitives/expressions";
import { zonesOfType } from "../primitives/layout";
import type { ActionTemplate } from "../rules/schema";
import { cardFace } from "../speech/cards";
import type { ActionDescriptor, CardFace, CardState, GameState, ZoneRef } from "../types";

function faceUpFace(state: GameState, cardId: string | undefined): CardFace | null {
  if (cardId === undefined) return null;
  const card = state.cards[cardId] as CardState;
  return card.faceUp ? cardFace(cardId, card) : null;
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
      const count = intValue(move.moveCards.count, ctx) as number;
      const source = pileOf(ctx.state, from);
      const cards = source
        .slice(source.length - count)
        .map((cardId) => faceUpFace(ctx.state, cardId))
        .filter((face): face is CardFace => face !== null);
      return {
        kind: "MOVE_CARDS",
        cards,
        from: ref(ctx, from),
        to: { ...ref(ctx, to), topCard: faceUpFace(ctx.state, pileOf(ctx.state, to).at(-1)) },
      };
    }
  }
  if (template.kind === "DEAL") {
    const deal = template.effects.find((effect) => "dealRow" in effect);
    if (deal !== undefined && "dealRow" in deal) {
      const from = zoneOf(deal.dealRow.from, ctx);
      const targets = zonesOfType(ctx.layout, deal.dealRow.type).length;
      return {
        kind: "DEAL",
        from: ref(ctx, from),
        cardCount: Math.min(pileOf(ctx.state, from).length, targets),
      };
    }
  }
  return { kind: "OTHER" };
}
