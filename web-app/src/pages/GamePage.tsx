import { GameActions } from "../components/GameActions";
import { GameBoard } from "../components/GameBoard";
import { GameHeader } from "../components/GameHeader";
import { HelpWalkthrough } from "../components/HelpWalkthrough";
import { StatusBanner } from "../components/StatusBanner";
import type { ColumnInteraction } from "../components/TableauColumn";
import { useCardDrag } from "../hooks/useCardDrag";
import { useCardSelection } from "../hooks/useCardSelection";
import { useGameSession } from "../hooks/useGameSession";
import { usePaused } from "../hooks/usePaused";
import { usePreferences } from "../hooks/usePreferences";
import { ConversationDock } from "../components/ConversationDock";
import { VoiceBar } from "../components/VoiceBar";
import { useVoice, useVoiceGameTarget } from "../hooks/useVoice";
import { isMove } from "../hooks/selection";
import type { GameCatalogEntry } from "../models/api";
import { CONVERSATION_HELP_STEPS, GAME_HELP_STEPS } from "./helpSteps";

export interface GamePageProps {
  game: GameCatalogEntry;
}

/** The game table: header, status, board and the message line. */
export function GamePage({ game }: GamePageProps): React.JSX.Element {
  const session = useGameSession(game.gameId);
  const help = usePreferences(game.gameId);
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

  const actions =
    envelope === undefined ? undefined : (
      <GameActions
        envelope={envelope}
        onUndo={run(() => session.undo("POINTER"))}
        onHint={run(() => session.requestHint())}
        onNewGame={run(() => session.newGame())}
      />
    );
  const conversational = help.preferences.voiceMode === "CONVERSATIONAL";
  const paused = usePaused();

  /* While play is paused, nothing listens or deals; the shell's banner says why. */
  if (paused) return <main className="pb-24" />;

  return (
    /* Room below the board for the voice controls fixed to the bottom of the game. */
    <main className="pb-24">
      {/* The saved mode must be known first, so a turn-based player's microphone never opens. */}
      {!help.loaded ? null : conversational ? (
        <ConversationDock
          sessionId={envelope?.session.sessionId ?? null}
          ready={help.game.helpSeen}
          actions={actions}
        />
      ) : (
        <VoiceBar actions={actions} />
      )}
      {envelope === undefined ? (
        <p className="text-2xl">Dealing the cards...</p>
      ) : (
        <>
          <GameHeader game={game} envelope={envelope} />
          <p aria-live="polite" className="mb-2 min-h-7 text-lg font-semibold">
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
          {help.loaded && !help.game.helpSeen ? (
            <HelpWalkthrough
              steps={conversational ? CONVERSATION_HELP_STEPS : GAME_HELP_STEPS}
              onFinish={() => {
                help.updateGame({ helpSeen: true });
              }}
            />
          ) : null}
        </>
      )}
    </main>
  );
}
