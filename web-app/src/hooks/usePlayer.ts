import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PlayerMe, Tier } from "../models/api";
import type { PlayerService } from "../services/types";

export type { PlayerService, SignInProvider } from "../services/types";
export { NewPasswordRequiredError } from "../services/errors";
import { useServices } from "./useServices";

const PLAYER_KEY = ["player"] as const;
const TIER_RANK: Record<Tier, number> = { GUEST: 0, PLAYER: 1, PLAYER_PLUS: 2, ADMIN: 3 };

export function tierAtLeast(tier: Tier, minimum: Tier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[minimum];
}

export interface UsePlayer {
  player: PlayerMe | undefined;
  loaded: boolean;
  /** Runs an account call that returns the new player, and updates everything that shows the player. */
  run: (work: (service: PlayerService) => Promise<PlayerMe>) => Promise<PlayerMe>;
  signOut: () => Promise<PlayerMe>;
  service: PlayerService;
}

export function usePlayer(): UsePlayer {
  const { player: service } = useServices();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: PLAYER_KEY, queryFn: () => service.me() });
  const mutation = useMutation({
    mutationFn: (work: (player: PlayerService) => Promise<PlayerMe>) => work(service),
    onSuccess: async (player) => {
      queryClient.setQueryData(PLAYER_KEY, player);
      /* Everything else is the caller's own data, which changes with who is signed in (and after a merge). */
      await queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "player" });
    },
  });
  return {
    player: query.data,
    loaded: query.isSuccess,
    run: (work) => mutation.mutateAsync(work),
    signOut: () => mutation.mutateAsync((player) => player.signOut()),
    service,
  };
}
