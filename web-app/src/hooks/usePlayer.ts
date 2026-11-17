import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PlayerMe, Tier } from "../models/api";
import { useServices } from "./useServices";

const PLAYER_KEY = ["player"] as const;
const TIER_RANK: Record<Tier, number> = { GUEST: 0, PLAYER: 1, PLAYER_PLUS: 2, ADMIN: 3 };

export function tierAtLeast(tier: Tier, minimum: Tier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[minimum];
}

export interface UsePlayer {
  player: PlayerMe | undefined;
  loaded: boolean;
  signIn: (email: string) => Promise<PlayerMe>;
  signOut: () => Promise<PlayerMe>;
}

export function usePlayer(): UsePlayer {
  const { player: service } = useServices();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: PLAYER_KEY, queryFn: () => service.me() });
  const onSuccess = (player: PlayerMe): void => {
    queryClient.setQueryData(PLAYER_KEY, player);
  };
  const signIn = useMutation({ mutationFn: (email: string) => service.signIn(email), onSuccess });
  const signOut = useMutation({ mutationFn: () => service.signOut(), onSuccess });
  return {
    player: query.data,
    loaded: query.isSuccess,
    signIn: (email) => signIn.mutateAsync(email),
    signOut: () => signOut.mutateAsync(),
  };
}
