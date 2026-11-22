import type { SessionEnvelope } from "../models/api";
import { Button } from "./Button";

export interface GameActionsProps {
  envelope: SessionEnvelope;
  onUndo: () => void;
  onHint: () => void;
  onNewGame: () => void;
}

/** Undo, Hint and New game, sized for the voice bar at the bottom of the game. */
export function GameActions({
  envelope,
  onUndo,
  onHint,
  onNewGame,
}: GameActionsProps): React.JSX.Element {
  const available = (id: string) =>
    envelope.metaActions.some((meta) => meta.id === id && meta.available);
  return (
    <div className="flex flex-wrap gap-2" data-help-id="game-actions">
      <Button size="compact" variant="secondary" disabled={!available("UNDO")} onClick={onUndo}>
        Undo
      </Button>
      <Button size="compact" variant="secondary" disabled={!available("HINT")} onClick={onHint}>
        Hint
      </Button>
      <Button size="compact" variant="secondary" onClick={onNewGame}>
        New game
      </Button>
    </div>
  );
}
