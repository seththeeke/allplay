import type { Decision } from "../../models/decision";

export class DecisionExistsError extends Error {
  override readonly name = "DecisionExistsError";
}

/** Decision persistence (data-model.md section 9); the in-memory and DynamoDB implementations share contract tests. */
export interface DecisionDao {
  create(decision: Decision): Promise<void>;
  get(decisionId: string): Promise<Decision | null>;
  /** A player's decisions, newest first (the `ByPlayer` index). */
  listByPlayer(playerId: string, limit: number): Promise<Decision[]>;
}
