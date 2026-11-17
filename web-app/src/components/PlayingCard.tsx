import type { CardView } from "../models/api";
import { rankLabel, SUIT_COLOR_CLASS, SUIT_SYMBOL } from "./cards";

export interface PlayingCardProps {
  card: CardView;
  highlighted?: boolean;
  /** Hide a face-up card from assistive technology when a surrounding control already names it. */
  decorative?: boolean;
}

/** One card. Face-down cards reveal nothing; face-up cards show a large rank and suit. */
export function PlayingCard({
  card,
  highlighted = false,
  decorative = false,
}: PlayingCardProps): React.JSX.Element {
  const ring = highlighted ? "outline-4 outline-highlight outline-offset-2 outline" : "";
  if (!card.faceUp) {
    return (
      <div
        role="img"
        aria-label="face-down card"
        className={`playing-card rounded-lg border-2 border-card-line bg-card-back ${ring}`}
      />
    );
  }
  return (
    <div
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : card.name}
      aria-hidden={decorative ? true : undefined}
      className={`playing-card rounded-lg border-2 border-card-line bg-card px-1 text-left ${SUIT_COLOR_CLASS[card.suit]} ${ring}`}
    >
      <span aria-hidden="true" className="card-index font-bold leading-none">
        {rankLabel(card.rank)}
        {SUIT_SYMBOL[card.suit]}
      </span>
      <span aria-hidden="true" className="card-center leading-none">
        {SUIT_SYMBOL[card.suit]}
      </span>
    </div>
  );
}
