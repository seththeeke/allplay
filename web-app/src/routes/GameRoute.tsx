import { useLocation } from "react-router";
import { useGames } from "../hooks/useGames";
import { GamePage } from "../pages/GamePage";
import { NotFoundPage } from "../pages/NotFoundPage";

/** Resolves direct game links such as /spider from the catalog; anything else is not found. */
export function GameRoute(): React.JSX.Element | null {
  const { pathname } = useLocation();
  const { loaded, byPath } = useGames();
  if (!loaded) return null;
  const game = byPath(pathname.replace(/\/+$/, ""));
  return game === undefined ? <NotFoundPage /> : <GamePage game={game} />;
}
