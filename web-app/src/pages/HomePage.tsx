import { GameTile } from "../components/GameTile";
import { PageHeading } from "../components/PageHeading";
import { useGames } from "../hooks/useGames";

/** Portal home: every playable game as a large tile. */
export function HomePage(): React.JSX.Element {
  const { games } = useGames();
  return (
    <main>
      <PageHeading title="All Play" lead="Card games you can play with your voice." />
      <h2 className="sr-only">Games</h2>
      <ul className="grid gap-6 md:grid-cols-2">
        {games.map((game) => (
          <GameTile key={game.gameId} game={game} />
        ))}
      </ul>
    </main>
  );
}
