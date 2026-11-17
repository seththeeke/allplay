import { GameBoard } from "../components/GameBoard";
import { GameHeader } from "../components/GameHeader";
import { StatusBanner } from "../components/StatusBanner";
import { useGameSession } from "../hooks/useGameSession";
import type { GameCatalogEntry } from "../models/api";

export interface GamePageProps {
  game: GameCatalogEntry;
}

const NONE: ReadonlySet<string> = new Set();

/** The game table: header, status, board and the message line. */
export function GamePage({ game }: GamePageProps): React.JSX.Element {
  const session = useGameSession(game.gameId);
  const { envelope, hintAction } = session;
  const hintCards =
    hintAction?.descriptor.kind === "MOVE_CARDS"
      ? new Set(hintAction.descriptor.cards.map((card) => card.cardId))
      : NONE;
  const hintTargets =
    hintAction?.descriptor.kind === "MOVE_CARDS"
      ? new Set([hintAction.descriptor.to.zoneId])
      : NONE;
  return (
    <main>
      {envelope === undefined ? (
        <p className="text-2xl">Dealing the cards...</p>
      ) : (
        <>
          <GameHeader
            game={game}
            envelope={envelope}
            onUndo={() => void session.undo("POINTER")}
            onHint={() => void session.requestHint()}
            onNewGame={() => void session.newGame()}
          />
          <p aria-live="polite" className="mb-3 min-h-9 text-2xl font-semibold">
            {session.message}
          </p>
          <StatusBanner
            envelope={envelope}
            onUndo={() => void session.undo("POINTER")}
            onNewGame={() => void session.newGame()}
          />
          <GameBoard
            envelope={envelope}
            highlightedCardIds={hintCards}
            targetZoneIds={hintTargets}
            onDeal={(actionId) => void session.apply(actionId, "POINTER")}
          />
        </>
      )}
    </main>
  );
}
