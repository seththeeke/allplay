import { useQuery } from "@tanstack/react-query";
import type { GameCatalogEntry, GameTile } from "../models/api";
import { useServices } from "./useServices";

export interface UseGames {
  games: GameCatalogEntry[];
  loaded: boolean;
  /** The game and tile a path opens, such as /spider/two-suits (productionalization.md section 6). */
  byPath: (path: string) => { game: GameCatalogEntry; tile: GameTile } | undefined;
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
    byPath: (path) => {
      for (const game of games) {
        const tile = game.tiles.find((candidate) => candidate.path === path);
        if (tile !== undefined) return { game, tile };
      }
      return undefined;
    },
  };
}
