import type { ZoneView } from "../models/api";
import { PlayingCard } from "./PlayingCard";

export interface TableauColumnProps {
  zone: ZoneView;
  highlightedCardIds?: ReadonlySet<string>;
  targeted?: boolean;
}

function describe(zone: ZoneView): string {
  const cards = zone.cards ?? [];
  const last = cards[cards.length - 1];
  if (last === undefined) return `${zone.label}, empty`;
  const topName = last.faceUp ? last.name : "face down";
  return `${zone.label}, ${String(cards.length)} cards, top card ${topName}`;
}

/** A numbered column of fanned cards. The number is large because players say it out loud. */
export function TableauColumn({
  zone,
  highlightedCardIds,
  targeted = false,
}: TableauColumnProps): React.JSX.Element {
  const cards = zone.cards ?? [];
  return (
    <section aria-label={describe(zone)} className="flex min-w-0 flex-col items-center">
      <p aria-hidden="true" className="mb-2 text-3xl font-bold text-on-table">
        {zone.index}
      </p>
      <div
        className={`flex flex-col items-center rounded-lg ${targeted ? "outline-4 outline-highlight outline-offset-4 outline" : ""}`}
      >
        {cards.length === 0 ? (
          <div className="card-slot rounded-lg border-2 border-dashed border-on-table" />
        ) : (
          cards.map((card, index) => (
            <div
              key={card.faceUp ? card.cardId : `down-${String(index)}`}
              className="fan-item"
              data-face={card.faceUp ? "up" : "down"}
            >
              <PlayingCard
                card={card}
                highlighted={card.faceUp && (highlightedCardIds?.has(card.cardId) ?? false)}
              />
            </div>
          ))
        )}
      </div>
    </section>
  );
}
