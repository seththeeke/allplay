import { PageHeading } from "../components/PageHeading";
import type { GameCatalogEntry } from "../models/api";

export interface GamePageProps {
  game: GameCatalogEntry;
}

/** The game table. The board, controls and voice flow are built in WA-4 to WA-6. */
export function GamePage({ game }: GamePageProps): React.JSX.Element {
  return (
    <main>
      <PageHeading title={game.name} />
    </main>
  );
}
