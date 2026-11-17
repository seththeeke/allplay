import { useState } from "react";
import type { LegalAction } from "../models/api";
import { moveTo, movesFrom, selectedCardIds, targetZones, type Selection } from "./selection";

export interface UseCardSelection {
  selection: Selection | null;
  targets: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  /** Tap a card: move the selection there when that column is a target, otherwise select the card's unit. */
  pressCard: (zoneId: string, depth: number, cardName: string) => void;
  /** Tap a column (its number or empty slot): move the selection there when legal. */
  pressZone: (zoneId: string) => void;
  /** Drop a dragged unit on a column. */
  drop: (from: Selection, zoneId: string) => void;
  clear: () => void;
}

export function useCardSelection(
  actions: LegalAction[],
  apply: (actionId: string) => void,
  announce: (message: string) => void,
): UseCardSelection {
  const [selection, setSelection] = useState<Selection | null>(null);
  const targets = targetZones(actions, selection);

  const tryMove = (from: Selection, zoneId: string): boolean => {
    const action = moveTo(actions, from, zoneId);
    if (action === undefined) return false;
    setSelection(null);
    apply(action.actionId);
    return true;
  };

  return {
    selection,
    targets,
    selectedIds: selectedCardIds(actions, selection),
    pressCard: (zoneId, depth, cardName) => {
      if (selection !== null && tryMove(selection, zoneId)) return;
      if (selection?.zoneId === zoneId && selection.depth === depth) {
        setSelection(null);
        return;
      }
      const candidate = { zoneId, depth };
      if (movesFrom(actions, candidate).length === 0) {
        setSelection(null);
        announce(`The ${cardName} can't move right now.`);
        return;
      }
      setSelection(candidate);
    },
    pressZone: (zoneId) => {
      if (selection !== null && !tryMove(selection, zoneId)) setSelection(null);
    },
    drop: (from, zoneId) => {
      if (!tryMove(from, zoneId)) announce("Those cards can't go there.");
    },
    clear: () => {
      setSelection(null);
    },
  };
}
