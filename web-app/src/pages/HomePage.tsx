import { GamesLeft } from "../components/GamesLeft";
import { GameTile } from "../components/GameTile";
import { PageHeading } from "../components/PageHeading";
import { useGames } from "../hooks/useGames";

/** Portal home: every playable game as a large tile. */
export function HomePage(): React.JSX.Element {
  const { games } = useGames();
  return (
    <main>
      <PageHeading title="All Play" lead="Card games you can play with your voice." />
      <GamesLeft />
      <h2 className="sr-only">Games</h2>
      <ul className="grid gap-6 md:grid-cols-2">
        {games
          .flatMap((game) => game.tiles)
          .map((tile) => (
            <GameTile key={tile.path} tile={tile} />
          ))}
      </ul>
    </main>
  );
}
