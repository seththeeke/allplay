import { useRef, useState } from "react";
import type { Selection } from "./selection";

export interface DragState extends Selection {
  dx: number;
  dy: number;
}

export interface UseCardDrag {
  drag: DragState | null;
  /** Pointer handler for a card that starts a drag of its unit. */
  startDrag: (selection: Selection) => (event: React.PointerEvent) => void;
  /** True once for the click that ends a drag, so the drop is not also treated as a tap. */
  consumeClick: () => boolean;
}

/** Movement in pixels before a press becomes a drag, so a shaky tap is still a tap. */
const DRAG_THRESHOLD = 12;

/**
 * Pointer-event drag and drop that works for mouse, pen and touch. The drop
 * target is the element under the pointer carrying a data-zone-id attribute.
 */
export function useCardDrag(onDrop: (from: Selection, zoneId: string) => void): UseCardDrag {
  const [drag, setDrag] = useState<DragState | null>(null);
  const suppressClick = useRef(false);

  const startDrag = (selection: Selection) => (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const originX = event.clientX;
    const originY = event.clientY;
    let moved = false;

    const onMove = (move: PointerEvent): void => {
      const dx = move.clientX - originX;
      const dy = move.clientY - originY;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      moved = true;
      setDrag({ ...selection, dx, dy });
    };
    const onUp = (up: PointerEvent): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrag(null);
      if (!moved) return;
      suppressClick.current = true;
      const target = document.elementFromPoint(up.clientX, up.clientY)?.closest("[data-zone-id]");
      const zoneId = target?.getAttribute("data-zone-id");
      if (zoneId !== null && zoneId !== undefined && zoneId !== selection.zoneId)
        onDrop(selection, zoneId);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return {
    drag,
    startDrag,
    consumeClick: () => {
      const suppressed = suppressClick.current;
      suppressClick.current = false;
      return suppressed;
    },
  };
}
