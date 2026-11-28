import { useState } from "react";
import { gamesLeftText, type AdminPlayer, type GameLimit } from "../models/api";
import { Button } from "./Button";
import { TextField } from "./TextField";

export interface GameLimitsPanelProps {
  onFind: (email: string) => Promise<AdminPlayer[]>;
  onSet: (playerId: string, gameLimit: GameLimit | null) => Promise<AdminPlayer>;
}

const CHOICES: { label: string; limit: GameLimit | null }[] = [
  { label: "No limit", limit: { unlimited: true } },
  { label: "5 a day", limit: { count: 5, period: "DAY" } },
  { label: "10 a day", limit: { count: 10, period: "DAY" } },
  { label: "Stage default", limit: null },
];

/** The limit an account has, in words. */
export function limitText(player: AdminPlayer): string {
  if (player.gameLimit === null) return "the stage default";
  if ("unlimited" in player.gameLimit) return "no limit";
  return `${String(player.gameLimit.count)} a ${player.gameLimit.period.toLowerCase()}`;
}

/** Finds accounts by email and sets their game limits (productionalization.md section 5, item 7). */
export function GameLimitsPanel({ onFind, onSet }: GameLimitsPanelProps): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [players, setPlayers] = useState<AdminPlayer[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const failed = (failure: unknown): void => {
    setNotice(failure instanceof Error ? failure.message : "That did not work.");
  };
  return (
    <section
      aria-labelledby="limits-heading"
      className="rounded-2xl border-4 border-line bg-surface p-4"
    >
      <h2 id="limits-heading" className="mb-3 text-3xl font-bold">
        Game limits
      </h2>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setNotice(null);
          onFind(email).then(setPlayers, failed);
        }}
      >
        <TextField
          id="limits-email"
          label="Account email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={setEmail}
        />
        <Button type="submit" variant="secondary">
          Find account
        </Button>
      </form>
      {players === null ? null : players.length === 0 ? (
        <p className="mt-3 text-xl text-muted">No account has that email.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-4 text-xl">
          {players.map((player) => (
            <li key={player.playerId} className="flex flex-col gap-2">
              <p>
                <span className="font-semibold">{player.email ?? player.playerId}</span> has{" "}
                {limitText(player)}
                {gamesLeftText(player.gameAllowance) === null
                  ? `, ${String(player.gameAllowance.used)} played today`
                  : `, ${gamesLeftText(player.gameAllowance) ?? ""}`}
                .
              </p>
              <div className="flex flex-wrap gap-2">
                {CHOICES.map((choice) => (
                  <Button
                    key={choice.label}
                    size="compact"
                    variant="secondary"
                    onClick={() => {
                      onSet(player.playerId, choice.limit).then((updated) => {
                        setPlayers((current) =>
                          (current ?? []).map((item) =>
                            item.playerId === updated.playerId ? updated : item,
                          ),
                        );
                        setNotice(
                          `Set ${updated.email ?? updated.playerId} to ${limitText(updated)}.`,
                        );
                      }, failed);
                    }}
                  >
                    {choice.label}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {notice === null ? null : (
        <p role="status" className="mt-3 text-xl font-semibold">
          {notice}
        </p>
      )}
    </section>
  );
}
