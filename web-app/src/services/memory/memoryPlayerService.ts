import { passwordProblem, type PlayerMe } from "../../models/api";
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

const fail = (message: string): Promise<never> => Promise.reject(new Error(message));
const isCode = (code: string): boolean => /^\d{6}$/.test(code.trim());

/**
 * Prototype accounts: any email signs in (one starting with "admin" signs in
 * as ADMIN), any six-digit code is accepted, and passwords are only checked
 * against the policy so the screens show realistic messages.
 */
export function createMemoryPlayerService(store: MemoryStore): PlayerService {
  const save = (player: PlayerMe): Promise<PlayerMe> => {
    store.write(KEY, player);
    return Promise.resolve(player);
  };
  const account = (email: string): Promise<PlayerMe> => {
    const normalized = email.trim().toLowerCase();
    return save({
      playerId: `ACCT#${normalized}`,
      kind: "ACCOUNT",
      tier: normalized.startsWith("admin") ? "ADMIN" : "PLAYER",
      displayName: normalized.replace(/@.*$/, ""),
      email: normalized,
    });
  };
  return {
    me: () => Promise.resolve(store.read<PlayerMe>(KEY, GUEST)),
    signIn: (email) => account(email),
    signInWithProvider: (provider) => account(`${provider.toLowerCase()}.player@example.com`),
    signUp: (_email, password) => {
      const problem = passwordProblem(password);
      return problem === null ? Promise.resolve() : fail(problem);
    },
    confirmSignUp: (email, code) =>
      isCode(code) ? account(email) : fail("Enter the 6-digit code from the email."),
    requestPasswordReset: () => Promise.resolve(),
    confirmPasswordReset: (_email, code, newPassword) => {
      if (!isCode(code)) return fail("Enter the 6-digit code from the email.");
      const problem = passwordProblem(newPassword);
      return problem === null ? Promise.resolve() : fail(problem);
    },
    signOut: () => save(GUEST),
    deleteAccount: () => save(GUEST),
  };
}
