import type {
  CardView,
  GameEvent,
  SessionEnvelope,
  SessionStatus,
  ZoneView,
} from "../../src/models/api";
import { face, type SimCard } from "./cards";
import { isWon, legalActions, stockDealsRemaining, type SpiderState } from "./simulator";

export interface StoredSession {
  sessionId: string;
  status: SessionStatus;
  version: number;
  state: SpiderState;
}

const ZONE_SHAPE: Record<string, Pick<ZoneView, "layout" | "region">> = {
  stock: { layout: "STACK", region: "BOTTOM" },
  foundation: { layout: "STACK", region: "TOP" },
  tableau: { layout: "FAN_DOWN", region: "MAIN" },
};

function zoneView(state: SpiderState, zoneId: string): ZoneView {
  const [type = "", index = "1"] = zoneId.split(".");
  const ids = state.zones[zoneId] ?? [];
  const cards: CardView[] = ids.map((id) => {
    const card = state.cards[id] as SimCard;
    return card.faceUp ? { ...face(card), faceUp: true } : { faceUp: false };
  });
  const shape = ZONE_SHAPE[type] ?? { layout: "STACK", region: "MAIN" };
  return {
    zoneId,
    type,
    index: Number(index),
    label: type === "tableau" ? `column ${index}` : type === "foundation" ? "completed run" : type,
    ...shape,
    count: ids.length,
    cards: type === "stock" ? null : cards,
  };
}

/** Builds the redacted envelope the server returns (game-engine.md section 11). */
export function toEnvelope(stored: StoredSession, events: GameEvent[] = []): SessionEnvelope {
  const { state } = stored;
  const inProgress = stored.status === "IN_PROGRESS";
  const legal = inProgress ? legalActions(state) : [];
  const options = { suits: state.options.suits, dealStyle: state.options.dealStyle };
  return {
    session: {
      sessionId: stored.sessionId,
      gameId: "spider-solitaire",
      status: stored.status,
      version: stored.version,
      options,
      summary: { ...state.vars, stockDealsRemaining: stockDealsRemaining(state) },
    },
    view: {
      gameId: "spider-solitaire",
      rulesVersion: 1,
      options,
      status: {
        status: isWon(state) ? "WON" : "IN_PROGRESS",
        blocked: inProgress && legal.length === 0,
        canUndo: inProgress && state.history.length > 0,
      },
      vars: { ...state.vars },
      zones: Object.keys(state.zones).map((zoneId) => zoneView(state, zoneId)),
    },
    legalActions: legal,
    metaActions: [
      { id: "UNDO", available: inProgress && state.history.length > 0 },
      { id: "HINT", available: inProgress },
    ],
    events,
  };
}
