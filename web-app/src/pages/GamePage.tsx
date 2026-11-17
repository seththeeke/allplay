import { GameBoard } from "../components/GameBoard";
import { GameHeader } from "../components/GameHeader";
import { StatusBanner } from "../components/StatusBanner";
import type { ColumnInteraction } from "../components/TableauColumn";
import { useCardDrag } from "../hooks/useCardDrag";
import { useCardSelection } from "../hooks/useCardSelection";
import { useGameSession } from "../hooks/useGameSession";
import { useVoice, useVoiceGameTarget } from "../hooks/useVoice";
import { isMove } from "../hooks/selection";
import type { GameCatalogEntry } from "../models/api";

export interface GamePageProps {
  game: GameCatalogEntry;
}

/** The game table: header, status, board and the message line. */
export function GamePage({ game }: GamePageProps): React.JSX.Element {
  const session = useGameSession(game.gameId);
  const { envelope, hintAction } = session;
  const selection = useCardSelection(
    envelope?.legalActions ?? [],
    (actionId) => void session.apply(actionId, "POINTER"),
    session.announce,
  );
  const dragging = useCardDrag(selection.drop);
  const voice = useVoice();
  useVoiceGameTarget(
    envelope === undefined
      ? null
      : {
          sessionId: envelope.session.sessionId,
          version: envelope.session.version,
          replace: session.replace,
          newGame: session.newGame,
        },
  );

  /* Voice proposals and choices light up the cards they would move and where they would go. */
  const voiceIds = new Set([
    ...(voice.proposedActionId === null ? [] : [voice.proposedActionId]),
    ...voice.choices.map((choice) => choice.actionId),
  ]);
  const voiceMoves = (envelope?.legalActions ?? [])
    .filter(isMove)
    .filter((action) => voiceIds.has(action.actionId))
    .map((action) => action.descriptor);

  const hintMove = hintAction?.descriptor.kind === "MOVE_CARDS" ? hintAction.descriptor : null;
  const highlighted = new Set([
    ...selection.selectedIds,
    ...(hintMove?.cards.map((card) => card.cardId) ?? []),
    ...voiceMoves.flatMap((move) => move.cards.map((card) => card.cardId)),
  ]);
  const targets = new Set([
    ...selection.targets,
    ...(hintMove === null ? [] : [hintMove.to.zoneId]),
    ...voiceMoves.map((move) => move.to.zoneId),
  ]);

  const interactionFor = (zoneId: string): ColumnInteraction => ({
    selectedIds: selection.selectedIds,
    dragging: dragging.drag?.zoneId === zoneId ? dragging.drag : null,
    onCardPress: (depth, cardName) => {
      if (!dragging.consumeClick()) selection.pressCard(zoneId, depth, cardName);
    },
    onZonePress: () => {
      selection.pressZone(zoneId);
    },
    onCardPointerDown: (depth) => dragging.startDrag({ zoneId, depth }),
  });
  const run = (work: () => Promise<void>) => () => {
    selection.clear();
    void work();
  };

  return (
    <main>
      {envelope === undefined ? (
        <p className="text-2xl">Dealing the cards...</p>
      ) : (
        <>
          <GameHeader
            game={game}
            envelope={envelope}
            onUndo={run(() => session.undo("POINTER"))}
            onHint={run(() => session.requestHint())}
            onNewGame={run(() => session.newGame())}
          />
          <p aria-live="polite" className="mb-3 min-h-9 text-2xl font-semibold">
            {session.message}
          </p>
          <StatusBanner
            envelope={envelope}
            onUndo={run(() => session.undo("POINTER"))}
            onNewGame={run(() => session.newGame())}
          />
          <GameBoard
            envelope={envelope}
            highlightedCardIds={highlighted}
            targetZoneIds={targets}
            onDeal={(actionId) => {
              run(() => session.apply(actionId, "POINTER"))();
            }}
            interactionFor={interactionFor}
          />
        </>
      )}
    </main>
  );
}
