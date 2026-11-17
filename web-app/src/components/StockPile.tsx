import type { LegalAction, ZoneView } from "../models/api";
import { Button } from "./Button";

export interface StockPileProps {
  zone: ZoneView;
  dealAction: LegalAction | undefined;
  dealsRemaining: number;
  onDeal: (actionId: string) => void;
}

/** The deal button, with the reason when dealing is not allowed (spider-solitaire.md section 4). */
export function StockPile({
  zone,
  dealAction,
  dealsRemaining,
  onDeal,
}: StockPileProps): React.JSX.Element {
  const reason =
    zone.count === 0
      ? "No cards left to deal"
      : dealAction === undefined
        ? "Fill empty columns first"
        : null;
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        disabled={dealAction === undefined}
        aria-describedby={reason === null ? undefined : "deal-reason"}
        onClick={() => {
          if (dealAction !== undefined) onDeal(dealAction.actionId);
        }}
      >
        Deal ({dealsRemaining} left)
      </Button>
      {reason === null ? null : (
        <p id="deal-reason" className="text-xl font-semibold text-on-table">
          {reason}
        </p>
      )}
    </div>
  );
}
