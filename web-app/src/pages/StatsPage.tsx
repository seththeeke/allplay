import { PageHeading } from "../components/PageHeading";
import { useGames } from "../hooks/useGames";
import { useStats } from "../hooks/useStats";
import type { GameCatalogEntry, StatsEntry } from "../models/api";

/** Spoken-style label for a variant key such as "dealStyle=MICROSOFT;suits=1", in the game's option order. */
export function variantLabel(game: GameCatalogEntry | undefined, variantKey: string): string {
  const values = new Map(
    variantKey.split(";").map((pair) => {
      const [name = "", value = ""] = pair.split("=");
      return [name, value] as const;
    }),
  );
  if (game === undefined) return [...values.values()].join(", ");
  return game.options
    .filter((option) => values.has(option.name))
    .map((option) => {
      const value = values.get(option.name) ?? "";
      return option.labels[value] ?? value;
    })
    .join(", ");
}

const percent = (entry: StatsEntry): string =>
  entry.gamesPlayed === 0
    ? "0%"
    : `${String(Math.round((entry.gamesWon / entry.gamesPlayed) * 100))}%`;

export function StatsPage(): React.JSX.Element {
  const { stats, loaded } = useStats();
  const { games } = useGames();
  return (
    <main>
      <PageHeading title="Your statistics" lead="Wins, losses and best scores for every game." />
      {loaded && stats.length === 0 ? (
        <p className="text-2xl">No finished games yet. Wins and losses appear here.</p>
      ) : null}
      {stats.length > 0 ? (
        <table className="w-full border-collapse text-left text-xl">
          <caption className="sr-only">Statistics by game and options</caption>
          <thead>
            <tr className="border-b-4 border-line">
              <th scope="col" className="p-3">
                Game
              </th>
              <th scope="col" className="p-3">
                Played
              </th>
              <th scope="col" className="p-3">
                Won
              </th>
              <th scope="col" className="p-3">
                Win rate
              </th>
              <th scope="col" className="p-3">
                Best score
              </th>
              <th scope="col" className="p-3">
                Win streak
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.map((entry) => {
              const game = games.find((candidate) => candidate.gameId === entry.gameId);
              return (
                <tr key={`${entry.gameId}#${entry.variantKey}`} className="border-b-2 border-line">
                  <th scope="row" className="p-3">
                    {game?.name ?? entry.gameId}
                    <span className="block text-lg font-normal text-muted">
                      {variantLabel(game, entry.variantKey)}
                    </span>
                  </th>
                  <td className="p-3">{entry.gamesPlayed}</td>
                  <td className="p-3">{entry.gamesWon}</td>
                  <td className="p-3">{percent(entry)}</td>
                  <td className="p-3">{entry.bestScore ?? "None yet"}</td>
                  <td className="p-3">
                    {entry.currentWinStreak} (best {entry.longestWinStreak})
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}
