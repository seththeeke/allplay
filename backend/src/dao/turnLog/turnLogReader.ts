/** One turn log event as it was written (action-decision.md section 9.1). */
export interface LoggedTurnEvent {
  event: "TURN_DECIDED" | "TURN_RESOLVED";
  decisionId: string;
  timestamp: string;
  gameId?: string | undefined;
  transcript?: string | undefined;
  outcome: string;
  failureClass?: string | undefined;
  clientLatencyMs?: number | undefined;
}

/** Reads a UTC day of the turn log, for the admin failure browser. */
export interface TurnLogReader {
  day(day: string): Promise<LoggedTurnEvent[]>;
}
