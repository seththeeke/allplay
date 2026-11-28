import { usePlayer } from "../hooks/usePlayer";
import { gamesLeftText } from "../models/api";

/** How many games the player has left in the window; nothing without a limit (productionalization.md section 5). */
export function GamesLeft(): React.JSX.Element | null {
  const { player } = usePlayer();
  const text = gamesLeftText(player?.gameAllowance);
  return text === null ? null : <p className="text-xl font-semibold">{text}</p>;
}
