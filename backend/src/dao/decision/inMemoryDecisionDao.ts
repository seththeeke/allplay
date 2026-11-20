import { DecisionSchema, type Decision } from "../../models/decision";
import { DecisionExistsError, type DecisionDao } from "./decisionDao";

/** DecisionDao over a map; items pass the schema and reads return copies. */
export function createInMemoryDecisionDao(): DecisionDao {
  const items = new Map<string, Decision>();
  const run = <T>(work: () => T): Promise<T> =>
    new Promise((resolve) => {
      resolve(work());
    });
  return {
    create: (decision) =>
      run(() => {
        if (items.has(decision.decisionId)) throw new DecisionExistsError(decision.decisionId);
        items.set(decision.decisionId, structuredClone(DecisionSchema.parse(decision)));
      }),
    get: (decisionId) =>
      run(() => {
        const item = items.get(decisionId);
        return item === undefined ? null : structuredClone(item);
      }),
    listByPlayer: (playerId, limit) =>
      run(() =>
        [...items.values()]
          .filter((item) => item.playerId === playerId)
          .sort((a, b) =>
            a.createdAt === b.createdAt
              ? b.decisionId.localeCompare(a.decisionId)
              : b.createdAt.localeCompare(a.createdAt),
          )
          .slice(0, limit)
          .map((item) => structuredClone(item)),
      ),
  };
}
