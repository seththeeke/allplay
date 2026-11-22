import type { Logger } from "../../logger";
import type { Decision } from "../../models/decision";

/** How a pending turn ended (action-decision.md section 9.1, `TURN_RESOLVED`). */
export interface TurnResolved {
  decisionId: string;
  playerId: string;
  sessionId?: string | undefined;
  resolution: string;
  outcome: string;
  failureClass: "HARD" | "SOFT" | "NONE";
  clientLatencyMs?: number | undefined;
}

/** Where turns are recorded: the only record of them (action-decision.md section 9.1). */
export interface TurnLog {
  decided(turn: Decision): Promise<void>;
  resolved(event: TurnResolved): Promise<void>;
}

/** The turn log as structured events through the backend logger, kept with the log group. */
export function createLoggerTurnLog(logger: Logger): TurnLog {
  return {
    decided: (turn) => {
      logger.info("TURN_DECIDED", { event: "TURN_DECIDED", ...turn });
      return Promise.resolve();
    },
    resolved: (event) => {
      logger.info("TURN_RESOLVED", { event: "TURN_RESOLVED", ...event });
      return Promise.resolve();
    },
  };
}

/** A turn log that also keeps each player's latest turns in memory, for the local Voice Lab. */
export function createRecentTurnLog(
  inner: TurnLog,
  keep = 50,
): TurnLog & { recent(playerId: string, limit: number): Decision[] } {
  const turns: Decision[] = [];
  return {
    decided: async (turn) => {
      await inner.decided(turn);
      turns.unshift(structuredClone(turn));
      turns.splice(keep);
    },
    resolved: async (event) => {
      await inner.resolved(event);
      const turn = turns.find((held) => held.decisionId === event.decisionId);
      if (turn !== undefined) {
        turn.outcome = event.outcome as Decision["outcome"];
        turn.failureClass = event.failureClass;
      }
    },
    recent: (playerId, limit) => turns.filter((turn) => turn.playerId === playerId).slice(0, limit),
  };
}
