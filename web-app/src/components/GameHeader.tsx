import type { GameCatalogEntry, SessionEnvelope } from "../models/api";

export interface GameHeaderProps {
  game: GameCatalogEntry;
  envelope: SessionEnvelope;
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

/** The game's name and options on the left, score and moves small at the far right. */
export function GameHeader({ game, envelope }: GameHeaderProps): React.JSX.Element {
  const { summary, options } = envelope.session;
  return (
    <header className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <div>
        <h1 className="text-2xl font-bold">{game.name}</h1>
        <p className="text-base text-muted">{optionLabels(game, options)}</p>
      </div>
      <dl className="ml-auto flex gap-4 text-lg">
        <div className="text-right">
          <dt className="text-sm text-muted">Score</dt>
          <dd className="font-bold">{summary["score"] ?? 0}</dd>
        </div>
        <div className="text-right">
          <dt className="text-sm text-muted">Moves</dt>
          <dd className="font-bold">{summary["moveCount"] ?? 0}</dd>
        </div>
      </dl>
    </header>
  );
}
