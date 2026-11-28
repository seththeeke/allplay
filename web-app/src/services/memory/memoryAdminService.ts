import {
  sampleDeployments,
  sampleDuplicates,
  sampleFailures,
  sampleMetrics,
} from "../../../test-data/admin";
import type { AdminPlayer, AndonState, Deployment, GameLimit } from "../../models/api";
import { ApiRequestError } from "../errors";
import type { AdminService } from "../types";

/** Admin API over deterministic sample data; a started deployment shows as in progress. */
export function createMemoryAdminService(now: () => Date = () => new Date()): AdminService {
  const started: Deployment[] = [];
  const merged = new Set<string>();
  const invited = new Set<string>();
  /* One sample account per email searched, with the 5 a day default (productionalization.md section 2). */
  const limits = new Map<string, GameLimit | null>();
  const shown = (email: string): AdminPlayer => {
    const gameLimit = limits.get(email) ?? null;
    const effective = gameLimit ?? { count: 5, period: "DAY" as const };
    return {
      playerId: `ACCT#${email}`,
      email,
      gameLimit,
      gameAllowance:
        "count" in effective
          ? { limit: effective.count, period: effective.period, used: 2, resetsAt: null }
          : { limit: null, period: null, used: 2, resetsAt: null },
    };
  };
  let andon: AndonState = { pulled: false, reason: null, pulledBy: null, changedAt: null };
  return {
    metrics: (from, to) =>
      Promise.resolve({
        days: sampleMetrics(now()).filter((day) => day.period >= from && day.period <= to),
      }),
    failures: (day) => Promise.resolve({ decisions: sampleFailures(day) }),
    deployments: () => Promise.resolve({ deployments: [...started, ...sampleDeployments(now())] }),
    startDeployment: () => {
      const at = now().toISOString();
      const executionId = `execution-admin-${String(started.length + 1)}`;
      started.unshift({
        executionId,
        status: "IN_PROGRESS",
        trigger: "ADMIN",
        startedAt: at,
        lastUpdatedAt: at,
        stages: [{ name: "Build", status: "IN_PROGRESS" }],
      });
      return Promise.resolve({ executionId });
    },
    duplicates: () =>
      Promise.resolve({
        duplicates: sampleDuplicates()
          .map((group) => ({
            ...group,
            accounts: group.accounts.filter((account) => !merged.has(account.playerId)),
          }))
          .filter((group) => group.accounts.length > 1),
      }),
    mergeAccounts: (primaryPlayerId, duplicatePlayerId) => {
      merged.add(duplicatePlayerId);
      return Promise.resolve({ primaryPlayerId, mergedPlayerId: duplicatePlayerId });
    },
    invite: (email) => {
      const address = email.trim().toLowerCase();
      if (invited.has(address))
        return Promise.reject(
          new ApiRequestError(409, {
            code: "ALREADY_INVITED",
            message: "That email already has an account.",
          }),
        );
      invited.add(address);
      return Promise.resolve({ email: address, status: "INVITED" as const });
    },
    findPlayers: (email) => {
      const address = email.trim().toLowerCase();
      if (!limits.has(address)) limits.set(address, null);
      return Promise.resolve({ players: [shown(address)] });
    },
    setGameLimit: (playerId, gameLimit) => {
      const email = playerId.replace(/^ACCT#/, "");
      limits.set(email, gameLimit);
      return Promise.resolve(shown(email));
    },
    andon: () => Promise.resolve(andon),
    setAndon: (pulled) => {
      andon = {
        pulled,
        reason: pulled ? "Pulled by an admin" : "Released by an admin",
        pulledBy: "ADMIN",
        changedAt: now().toISOString(),
      };
      return Promise.resolve(andon);
    },
  };
}
