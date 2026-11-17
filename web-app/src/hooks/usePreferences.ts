import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_APP_PREFERENCES,
  DEFAULT_GAME_PREFERENCES,
  type AppPreferences,
  type GamePreferences,
  type PatchAppPreferences,
  type PatchGamePreferences,
  type PreferencesResponse,
} from "../models/api";
import { mergeDefined } from "../services/mergeDefined";
import { useServices } from "./useServices";

export const PREFERENCES_KEY = ["preferences"] as const;

export interface UsePreferences {
  /** Effective preferences: game overrides, then application preferences, then defaults. */
  preferences: AppPreferences;
  game: GamePreferences;
  loaded: boolean;
  updateApp: (patch: PatchAppPreferences) => void;
  updateGame: (patch: PatchGamePreferences) => void;
}

export function usePreferences(gameId?: string): UsePreferences {
  const { preferences: service } = useServices();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: PREFERENCES_KEY, queryFn: () => service.get() });

  const optimistic = (update: (current: PreferencesResponse) => PreferencesResponse): void => {
    const current = queryClient.getQueryData<PreferencesResponse>(PREFERENCES_KEY);
    if (current !== undefined) queryClient.setQueryData(PREFERENCES_KEY, update(current));
  };

  const appMutation = useMutation({
    mutationFn: (patch: PatchAppPreferences) => service.patchApp(patch),
    onMutate: (patch) => {
      optimistic((current) => ({ ...current, app: mergeDefined(current.app, patch) }));
    },
    onSuccess: (saved) => queryClient.setQueryData(PREFERENCES_KEY, saved),
  });

  const gameMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PatchGamePreferences }) =>
      service.patchGame(id, patch),
    onMutate: ({ id, patch }) => {
      optimistic((current) => ({
        ...current,
        games: {
          ...current.games,
          [id]: mergeDefined(current.games[id] ?? DEFAULT_GAME_PREFERENCES, patch),
        },
      }));
    },
    onSuccess: (saved) => queryClient.setQueryData(PREFERENCES_KEY, saved),
  });

  const app = query.data?.app ?? DEFAULT_APP_PREFERENCES;
  const game =
    (gameId === undefined ? undefined : query.data?.games[gameId]) ?? DEFAULT_GAME_PREFERENCES;
  return {
    preferences: mergeDefined(app, game.overrides),
    game,
    loaded: query.isSuccess,
    updateApp: (patch) => {
      appMutation.mutate(patch);
    },
    updateGame: (patch) => {
      if (gameId !== undefined) gameMutation.mutate({ id: gameId, patch });
    },
  };
}
