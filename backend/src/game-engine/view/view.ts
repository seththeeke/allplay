import type { GameLayout } from "../primitives/layout";
import type { ZoneType } from "../rules/schema";
import { cardFace } from "../speech/cards";
import type { CardView, GameState, GameStatusInfo, GameView, ZoneRef } from "../types";

/**
 * The redacted view for a seat (game-engine.md section 10). Face-down cards
 * carry no id, suit or rank; COUNT_ONLY zones show only their size.
 */
export function buildView(state: GameState, layout: GameLayout, status: GameStatusInfo): GameView {
  return {
    gameId: state.gameId,
    rulesVersion: state.rulesVersion,
    options: { ...state.options },
    status,
    vars: { ...state.vars },
    zones: layout.order.map((zoneId) => {
      const zoneRef = layout.refs.get(zoneId) as ZoneRef;
      const zoneType = layout.zoneTypes.get(zoneRef.type) as ZoneType;
      const pile = state.zones[zoneId] as string[];
      const cards =
        zoneType.visibility === "CARDS"
          ? pile.map((cardId): CardView => {
              const card = state.cards[cardId];
              return card?.faceUp === true
                ? { ...cardFace(cardId, card), faceUp: true }
                : { faceUp: false };
            })
          : null;
      return {
        ...zoneRef,
        layout: zoneType.layout,
        region: zoneType.region,
        count: pile.length,
        cards,
      };
    }),
  };
}
