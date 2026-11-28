import { Link } from "react-router";
import type { GameTile as Tile } from "../models/api";

export interface GameTileProps {
  tile: Tile;
}

/** One large, fully clickable tile per game tile, such as each Spider suit count. The whole tile is a single link. */
export function GameTile({ tile }: GameTileProps): React.JSX.Element {
  return (
    <li>
      <Link
        to={tile.path}
        className="block rounded-2xl border-4 border-line bg-surface p-6 hover:border-accent"
      >
        <h3 className="text-3xl font-bold">{tile.name}</h3>
        <p className="mt-2 text-xl text-muted">{tile.description}</p>
        <span className="mt-4 inline-block rounded-xl bg-accent px-6 py-3 text-2xl font-semibold text-on-accent">
          Play {tile.name}
        </span>
      </Link>
    </li>
  );
}
