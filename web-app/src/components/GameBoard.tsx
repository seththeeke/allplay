import type { SessionEnvelope } from "../models/api";
import { FoundationRow } from "./FoundationRow";
import { StockPile } from "./StockPile";
import { TableauColumn } from "./TableauColumn";

export interface GameBoardProps {
  envelope: SessionEnvelope;
  highlightedCardIds: ReadonlySet<string>;
  targetZoneIds: ReadonlySet<string>;
  onDeal: (actionId: string) => void;
}

/** Lays out zones by region: completed runs on top, columns in the middle, the stock below. */
export function GameBoard({
  envelope,
  highlightedCardIds,
  targetZoneIds,
  onDeal,
}: GameBoardProps): React.JSX.Element {
  const zones = envelope.view.zones;
  const top = zones.filter((zone) => zone.region === "TOP");
  const main = zones.filter((zone) => zone.region === "MAIN");
  const stock = zones.find((zone) => zone.region === "BOTTOM");
  const deal = envelope.legalActions.find((action) => action.descriptor.kind === "DEAL");
  return (
    <div role="region" aria-label="Card table" className="card-board rounded-2xl bg-table p-3">
      <FoundationRow zones={top} />
      <div className="mt-4 grid grid-cols-10 gap-[0.8vw]">
        {main.map((zone) => (
          <TableauColumn
            key={zone.zoneId}
            zone={zone}
            highlightedCardIds={highlightedCardIds}
            targeted={targetZoneIds.has(zone.zoneId)}
          />
        ))}
      </div>
      {stock === undefined ? null : (
        <div className="mt-6 flex justify-end">
          <StockPile
            zone={stock}
            dealAction={deal}
            dealsRemaining={envelope.session.summary["stockDealsRemaining"] ?? 0}
            onDeal={onDeal}
          />
        </div>
      )}
    </div>
  );
}
