import type { Decision } from "../../models/decision";

export class DecisionExistsError extends Error {
  override readonly name = "DecisionExistsError";
}

export class DecisionMissingError extends Error {
  override readonly name = "DecisionMissingError";
}

/** Decision persistence (data-model.md section 9); the in-memory and DynamoDB implementations share contract tests. */
export interface DecisionDao {
  create(decision: Decision): Promise<void>;
  get(decisionId: string): Promise<Decision | null>;
  /** Replaces an existing decision; throws DecisionMissingError when there is none. */
  update(decision: Decision): Promise<void>;
  /** A player's decisions, newest first (the `ByPlayer` index). */
  listByPlayer(playerId: string, limit: number): Promise<Decision[]>;
}
