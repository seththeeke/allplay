import { useLocation } from "react-router";
import { useGames } from "../hooks/useGames";
import { GamePage } from "../pages/GamePage";
import { NotFoundPage } from "../pages/NotFoundPage";

/** Resolves direct game links such as /spider from the catalog; anything else is not found. */
export function GameRoute(): React.JSX.Element | null {
  const { pathname } = useLocation();
  const { loaded, byPath } = useGames();
  if (!loaded) return null;
  const found = byPath(pathname.replace(/\/+$/, ""));
  /* Each tile is its own page, so a choice made on one never carries to another. */
  return found === undefined ? (
    <NotFoundPage />
  ) : (
    <GamePage key={found.tile.path} game={found.game} tile={found.tile} />
  );
}
