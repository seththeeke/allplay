import type { GameCatalogEntry, SessionEnvelope } from "../models/api";
import { Button } from "./Button";

export interface GameHeaderProps {
  game: GameCatalogEntry;
  envelope: SessionEnvelope;
  onUndo: () => void;
  onHint: () => void;
  onNewGame: () => void;
}

/** Spoken labels for the current options, for example "one suit". */
export function optionLabels(
  game: GameCatalogEntry,
  options: SessionEnvelope["session"]["options"],
): string {
  return game.options
    .map((option) => {
      const value = options[option.name];
      return value === undefined ? null : (option.labels[String(value)] ?? String(value));
    })
    .filter((label): label is string => label !== null)
    .join(", ");
}

export function GameHeader({
  game,
  envelope,
  onUndo,
  onHint,
  onNewGame,
}: GameHeaderProps): React.JSX.Element {
  const { summary, options } = envelope.session;
  const canUndo = envelope.metaActions.some((meta) => meta.id === "UNDO" && meta.available);
  const canHint = envelope.metaActions.some((meta) => meta.id === "HINT" && meta.available);
  return (
    <header className="mb-4 flex flex-wrap items-center gap-4">
      <div className="mr-auto">
        <h1 className="text-4xl font-bold">{game.name}</h1>
        <p className="text-xl text-muted">{optionLabels(game, options)}</p>
      </div>
      <dl className="flex gap-6 text-2xl">
        <div>
          <dt className="text-lg text-muted">Score</dt>
          <dd className="font-bold">{summary["score"] ?? 0}</dd>
        </div>
        <div>
          <dt className="text-lg text-muted">Moves</dt>
          <dd className="font-bold">{summary["moveCount"] ?? 0}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2" data-help-id="game-actions">
        <Button variant="secondary" disabled={!canUndo} onClick={onUndo}>
          Undo
        </Button>
        <Button variant="secondary" disabled={!canHint} onClick={onHint}>
          Hint
        </Button>
        <Button variant="secondary" onClick={onNewGame}>
          New game
        </Button>
      </div>
    </header>
  );
}
