import { useQuery } from "@tanstack/react-query";
import type { StatsEntry } from "../models/api";
import { useServices } from "./useServices";

export function useStats(): { stats: StatsEntry[]; loaded: boolean } {
  const { stats } = useServices();
  const query = useQuery({ queryKey: ["stats"], queryFn: () => stats.list() });
  return { stats: query.data?.stats ?? [], loaded: query.isSuccess };
}
