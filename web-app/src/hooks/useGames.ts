import { useQuery } from "@tanstack/react-query";
import type { GameCatalogEntry } from "../models/api";
import { useServices } from "./useServices";

export interface UseGames {
  games: GameCatalogEntry[];
  loaded: boolean;
  byPath: (path: string) => GameCatalogEntry | undefined;
}

export function useGames(): UseGames {
  const { games: service } = useServices();
  const query = useQuery({
    queryKey: ["games"],
    queryFn: () => service.list(),
    staleTime: Infinity,
  });
  const games = query.data?.games ?? [];
  return {
    games,
    loaded: query.isSuccess,
    byPath: (path) => games.find((game) => game.path === path),
  };
}
