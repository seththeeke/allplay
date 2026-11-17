import type { PlayerMe } from "../../models/api";
import type { PlayerService } from "../types";
import type { MemoryStore } from "./memoryStore";

const KEY = "allplay.memory.player";
const GUEST: PlayerMe = {
  playerId: "GUEST#local-prototype",
  kind: "GUEST",
  tier: "GUEST",
  displayName: null,
  email: null,
};

/** Prototype sign-in: any email signs in as a PLAYER; an email starting with "admin" signs in as ADMIN. */
export function createMemoryPlayerService(store: MemoryStore): PlayerService {
  const save = (player: PlayerMe): Promise<PlayerMe> => {
    store.write(KEY, player);
    return Promise.resolve(player);
  };
  return {
    me: () => Promise.resolve(store.read<PlayerMe>(KEY, GUEST)),
    signIn: (email) => {
      const normalized = email.trim().toLowerCase();
      return save({
        playerId: `ACCT#${normalized}`,
        kind: "ACCOUNT",
        tier: normalized.startsWith("admin") ? "ADMIN" : "PLAYER",
        displayName: normalized.split("@")[0] ?? normalized,
        email: normalized,
      });
    },
    signOut: () => save(GUEST),
  };
}
