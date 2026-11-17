import type { LegalAction } from "../models/api";

/**
 * Pointer and keyboard play match against the server's legal actions only
 * (game-engine.md section 12): the client never decides what is legal.
 */

export interface Selection {
  zoneId: string;
  /** Number of cards from the top of the zone being moved. */
  depth: number;
}

type MoveDescriptor = Extract<LegalAction["descriptor"], { kind: "MOVE_CARDS" }>;
export type MoveAction = LegalAction & { descriptor: MoveDescriptor };

export function isMove(action: LegalAction): action is MoveAction {
  return action.descriptor.kind === "MOVE_CARDS";
}

export function movesFrom(actions: LegalAction[], selection: Selection): MoveAction[] {
  return actions
    .filter(isMove)
    .filter(
      (action) =>
        action.descriptor.from.zoneId === selection.zoneId &&
        action.descriptor.cards.length === selection.depth,
    );
}

export function targetZones(
  actions: LegalAction[],
  selection: Selection | null,
): ReadonlySet<string> {
  if (selection === null) return new Set();
  return new Set(movesFrom(actions, selection).map((action) => action.descriptor.to.zoneId));
}

export function moveTo(
  actions: LegalAction[],
  selection: Selection,
  zoneId: string,
): MoveAction | undefined {
  return movesFrom(actions, selection).find((action) => action.descriptor.to.zoneId === zoneId);
}

/** Card ids moved by a selection, for highlighting. */
export function selectedCardIds(
  actions: LegalAction[],
  selection: Selection | null,
): ReadonlySet<string> {
  if (selection === null) return new Set();
  const first = movesFrom(actions, selection)[0];
  return new Set(first?.descriptor.cards.map((card) => card.cardId));
}
