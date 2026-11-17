import type { SessionEnvelope } from "../models/api";
import { Button } from "./Button";

export interface StatusBannerProps {
  envelope: SessionEnvelope;
  onUndo: () => void;
  onNewGame: () => void;
}

/** Shown when the game is won or no move is left (spider-solitaire.md section 4). */
export function StatusBanner({
  envelope,
  onUndo,
  onNewGame,
}: StatusBannerProps): React.JSX.Element | null {
  const { status } = envelope.view;
  const won = envelope.session.status === "WON" || status.status === "WON";
  if (!won && !status.blocked) return null;
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-4 rounded-2xl border-4 border-accent bg-surface p-4"
    >
      <p className="mr-auto text-3xl font-bold">
        {won
          ? `You won. Final score ${String(envelope.session.summary["score"] ?? 0)}.`
          : "No moves left."}
      </p>
      {won || !status.canUndo ? null : (
        <Button variant="secondary" onClick={onUndo}>
          Undo
        </Button>
      )}
      <Button onClick={onNewGame}>New game</Button>
    </div>
  );
}
