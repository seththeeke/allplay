import type { GameCatalogEntry, GameTile, SessionEnvelope } from "../models/api";
import { optionsMatch } from "../hooks/useGameSession";
import { Button } from "./Button";
import { optionLabels } from "./GameHeader";

export interface InProgressChoiceProps {
  game: GameCatalogEntry;
  tile: GameTile;
  envelope: SessionEnvelope;
  onContinue: () => void;
  onStart: () => void;
}

/** The game in progress by its tile's name, or by its options when no tile starts it. */
export function inProgressName(game: GameCatalogEntry, envelope: SessionEnvelope): string {
  const tile = game.tiles.find((candidate) =>
    optionsMatch(envelope.session.options, candidate.options),
  );
  return tile?.name ?? `${game.name}, ${optionLabels(game, envelope.session.options)}`;
}

/**
 * A tile opened while a game with other options is in progress
 * (productionalization.md section 6): continue that game, or start the
 * tile's game, which ends the other one.
 */
export function InProgressChoice({
  game,
  tile,
  envelope,
  onContinue,
  onStart,
}: InProgressChoiceProps): React.JSX.Element {
  return (
    <section
      aria-labelledby="in-progress-heading"
      className="flex flex-col gap-4 rounded-2xl border-4 border-line bg-surface p-6"
    >
      <h2 id="in-progress-heading" className="text-3xl font-bold">
        You have a game of {inProgressName(game, envelope)} in progress.
      </h2>
      <p className="text-xl">Starting a new game ends that one.</p>
      <div className="flex flex-wrap gap-4">
        <Button onClick={onContinue}>Continue that game</Button>
        <Button variant="secondary" onClick={onStart}>
          Start {tile.name}
        </Button>
      </div>
    </section>
  );
}
