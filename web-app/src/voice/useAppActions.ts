import { useNavigate } from "react-router";
import { useGames } from "../hooks/useGames";
import { usePlayer } from "../hooks/usePlayer";
import { usePreferences } from "../hooks/usePreferences";
import type { AppAction } from "../models/api";
import type { VoiceGameTarget } from "./VoiceContext";

const ZOOM_STEP = 0.25;
const clampZoom = (value: number): number => Math.min(3, Math.max(1, value));

/** Runs application actions in the client (action-decision.md section 7). */
export function useAppActions(
  repeat: () => void,
  gameTarget: () => VoiceGameTarget | null,
): (action: AppAction) => void {
  const navigate = useNavigate();
  const { games } = useGames();
  const { preferences, updateApp } = usePreferences();
  const { signOut } = usePlayer();
  const pathOf = (gameId: string): string =>
    games.find((game) => game.gameId === gameId)?.path ?? "/";

  return (action) => {
    switch (action.action) {
      case "ZOOM_IN":
        updateApp({ zoomLevel: clampZoom(preferences.zoomLevel + ZOOM_STEP) });
        return;
      case "ZOOM_OUT":
        updateApp({ zoomLevel: clampZoom(preferences.zoomLevel - ZOOM_STEP) });
        return;
      case "ZOOM_RESET":
        updateApp({ zoomLevel: 1.25 });
        return;
      case "SET_THEME":
        updateApp({ theme: action.theme });
        return;
      case "SET_VOICE_OUTPUT":
        updateApp({ voiceOutputEnabled: action.enabled });
        return;
      case "SET_AUTO_CONFIRM":
        updateApp({ autoConfirm: action.enabled });
        return;
      case "REPEAT":
        repeat();
        return;
      case "SHOW_HELP":
        void navigate("/help");
        return;
      case "SHOW_STATS":
        void navigate("/stats");
        return;
      case "SHOW_SETTINGS":
        void navigate("/settings");
        return;
      case "GO_HOME":
        void navigate("/");
        return;
      case "SIGN_IN":
        void navigate("/sign-in");
        return;
      case "SIGN_OUT":
        void signOut().then(() => navigate("/"));
        return;
      case "OPEN_GAME":
        void navigate(pathOf(action.gameId));
        return;
      case "NEW_GAME": {
        const target = gameTarget();
        if (target === null) void navigate(pathOf(action.gameId));
        else
          void target.newGame(
            Object.keys(action.options).length === 0 ? undefined : action.options,
          );
        return;
      }
    }
  };
}
