import type { CardView, ZoneView } from "../models/api";
import { PlayingCard } from "./PlayingCard";

export interface ColumnInteraction {
  selectedIds: ReadonlySet<string>;
  /** Cards of this column being dragged (count from the top) and the pointer offset. */
  dragging: { depth: number; dx: number; dy: number } | null;
  onCardPress: (depth: number, cardName: string) => void;
  onZonePress: () => void;
  onCardPointerDown: (depth: number) => (event: React.PointerEvent) => void;
}

export interface TableauColumnProps {
  zone: ZoneView;
  highlightedCardIds?: ReadonlySet<string>;
  targeted?: boolean;
  interaction?: ColumnInteraction;
}

function describe(zone: ZoneView): string {
  const cards = zone.cards ?? [];
  const last = cards[cards.length - 1];
  if (last === undefined) return `${zone.label}, empty`;
  const topName = last.faceUp ? last.name : "face down";
  return `${zone.label}, ${String(cards.length)} cards, top card ${topName}`;
}

const TARGET_RING = "outline-4 outline-highlight outline-offset-4 outline";

/**
 * A numbered column of fanned cards. Face-up cards are buttons: tapping one
 * selects it and the cards on it, tapping a highlighted column moves them.
 */
export function TableauColumn({
  zone,
  highlightedCardIds,
  targeted = false,
  interaction,
}: TableauColumnProps): React.JSX.Element {
  const cards = zone.cards ?? [];
  const numberLabel = targeted ? `Move to ${zone.label}` : zone.label;
  const renderCard = (card: CardView, index: number): React.JSX.Element => {
    const depth = cards.length - index;
    const dragging = interaction?.dragging;
    const lifted = dragging !== null && dragging !== undefined && depth <= dragging.depth;
    const style = lifted
      ? { transform: `translate(${String(dragging.dx)}px, ${String(dragging.dy)}px)` }
      : undefined;
    const highlighted = card.faceUp && (highlightedCardIds?.has(card.cardId) ?? false);
    const selected = card.faceUp && (interaction?.selectedIds.has(card.cardId) ?? false);
    return (
      <div
        key={card.faceUp ? card.cardId : `down-${String(index)}`}
        className={`fan-item ${lifted ? "pointer-events-none relative z-10" : ""}`}
        data-face={card.faceUp ? "up" : "down"}
        style={style}
      >
        {card.faceUp && interaction !== undefined ? (
          <button
            type="button"
            aria-label={`${card.name}, ${zone.label}`}
            aria-pressed={selected}
            className="block touch-none rounded-lg"
            onPointerDown={interaction.onCardPointerDown(depth)}
            onClick={() => {
              interaction.onCardPress(depth, card.name);
            }}
          >
            <PlayingCard card={card} highlighted={highlighted || selected} decorative />
          </button>
        ) : (
          <PlayingCard card={card} highlighted={highlighted} />
        )}
      </div>
    );
  };
  return (
    <section
      aria-label={describe(zone)}
      data-zone-id={zone.zoneId}
      className="flex min-w-0 flex-col items-center"
    >
      <button
        type="button"
        aria-label={numberLabel}
        disabled={interaction === undefined}
        onClick={interaction?.onZonePress}
        className={`mb-2 min-w-12 rounded-lg text-3xl font-bold text-on-table ${targeted ? TARGET_RING : ""}`}
      >
        {zone.index}
      </button>
      <div className={`flex flex-col items-center rounded-lg ${targeted ? TARGET_RING : ""}`}>
        {cards.length === 0 ? (
          <button
            type="button"
            aria-label={targeted ? `Move to empty ${zone.label}` : `Empty ${zone.label}`}
            disabled={interaction === undefined}
            onClick={interaction?.onZonePress}
            className="card-slot rounded-lg border-2 border-dashed border-on-table"
          />
        ) : (
          cards.map(renderCard)
        )}
      </div>
    </section>
  );
}
