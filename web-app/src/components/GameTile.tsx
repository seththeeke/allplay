import { Link } from "react-router";
import type { GameCatalogEntry } from "../models/api";

export interface GameTileProps {
  game: GameCatalogEntry;
}

/** One large, fully clickable tile per game. The whole tile is a single link. */
export function GameTile({ game }: GameTileProps): React.JSX.Element {
  return (
    <li>
      <Link
        to={game.path}
        className="block rounded-2xl border-4 border-line bg-surface p-6 hover:border-accent"
      >
        <h3 className="text-3xl font-bold">{game.name}</h3>
        <p className="mt-2 text-xl text-muted">{game.description}</p>
        <span className="mt-4 inline-block rounded-xl bg-accent px-6 py-3 text-2xl font-semibold text-on-accent">
          Play {game.name}
        </span>
      </Link>
    </li>
  );
}
