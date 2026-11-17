import { useNavigate } from "react-router";
import { Button } from "../components/Button";
import { PageHeading } from "../components/PageHeading";
import { useGames } from "../hooks/useGames";
import { usePreferences } from "../hooks/usePreferences";
import type { GameCatalogEntry } from "../models/api";

const COMMANDS: [string, string][] = [
  ['"three to seven"', "Move the cards from column 3 to column 7."],
  ['"seven of hearts onto the eight"', "Move a card by name."],
  ['"deal"', "Deal a new row of cards."],
  ['"undo" or "hint"', "Take back a move, or see a good one."],
  ['"yes" or "no"', "Confirm or cancel what was heard."],
  ['"zoom in" or "zoom out"', "Make everything bigger or smaller."],
  ['"high contrast", "black and white", "four color", "dark"', "Change the colors."],
  ['"new game", "go home", "settings"', "Move around All Play."],
];

const KEYS: [string, string][] = [
  ["Space", "Start talking."],
  ["Enter", "Confirm a move."],
  ["Escape", "Cancel."],
  ["1 to 4", "Pick a numbered choice."],
];

function ReplayTour({ game }: { game: GameCatalogEntry }): React.JSX.Element {
  const { updateGame } = usePreferences(game.gameId);
  const navigate = useNavigate();
  return (
    <Button
      onClick={() => {
        updateGame({ helpSeen: false });
        void navigate(game.path);
      }}
    >
      Show the {game.name} tour
    </Button>
  );
}

export function HelpPage(): React.JSX.Element {
  const { games } = useGames();
  return (
    <main className="flex flex-col gap-8">
      <PageHeading title="Help" lead="Learn how to play with your voice or keyboard." />
      <section aria-labelledby="say-heading">
        <h2 id="say-heading" className="mb-3 text-3xl font-bold">
          Things you can say
        </h2>
        <dl className="grid gap-3 text-2xl md:grid-cols-[auto_1fr]">
          {COMMANDS.map(([phrase, meaning]) => (
            <div key={phrase} className="contents">
              <dt className="font-bold">{phrase}</dt>
              <dd className="mb-2 md:mb-0">{meaning}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="keys-heading">
        <h2 id="keys-heading" className="mb-3 text-3xl font-bold">
          Keys
        </h2>
        <dl className="grid gap-3 text-2xl md:grid-cols-[auto_1fr]">
          {KEYS.map(([key, meaning]) => (
            <div key={key} className="contents">
              <dt className="font-bold">{key}</dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="tour-heading">
        <h2 id="tour-heading" className="mb-3 text-3xl font-bold">
          Guided tours
        </h2>
        <div className="flex flex-wrap gap-3">
          {games.map((game) => (
            <ReplayTour key={game.gameId} game={game} />
          ))}
        </div>
      </section>
    </main>
  );
}
