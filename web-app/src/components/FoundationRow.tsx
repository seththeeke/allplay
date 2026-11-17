import type { ZoneView } from "../models/api";
import { PlayingCard } from "./PlayingCard";

export interface FoundationRowProps {
  zones: ZoneView[];
}

/** Completed runs along the top: each finished suit shows its king. */
export function FoundationRow({ zones }: FoundationRowProps): React.JSX.Element {
  const done = zones.filter((zone) => zone.count > 0).length;
  return (
    <section
      aria-label={`Completed runs: ${String(done)} of ${String(zones.length)}`}
      className="flex flex-wrap gap-2"
    >
      {zones.map((zone) => {
        const king = zone.cards?.[0];
        return (
          <div key={zone.zoneId}>
            {king === undefined ? (
              <div className="card-slot rounded-lg border-2 border-dashed border-on-table opacity-60" />
            ) : (
              <PlayingCard card={king} />
            )}
          </div>
        );
      })}
    </section>
  );
}
