import { SeatAssignmentSchema, type SeatAssignment } from "../../models/seatAssignment";
import type { SeatAssignmentDao } from "./seatAssignmentDao";

/** SeatAssignmentDao over a map; items pass the schema and reads return copies. */
export function createInMemorySeatAssignmentDao(): SeatAssignmentDao {
  const items = new Map<string, SeatAssignment>();
  const key = (playerId: string, sessionId: string) => `${playerId}|${sessionId}`;
  const run = <T>(work: () => T): Promise<T> =>
    new Promise((resolve) => {
      resolve(work());
    });
  return {
    put: (seat) =>
      run(() => {
        items.set(
          key(seat.playerId, seat.sessionId),
          structuredClone(SeatAssignmentSchema.parse(seat)),
        );
      }),
    get: (playerId, sessionId) =>
      run(() => {
        const item = items.get(key(playerId, sessionId));
        return item === undefined ? null : structuredClone(item);
      }),
    currentFor: (playerId, gameId) =>
      run(() => {
        const match = [...items.values()]
          .filter(
            (item) =>
              item.playerGameKey === `${playerId}|${gameId}` &&
              item.statusSortKey.startsWith("IN_PROGRESS#"),
          )
          .sort((a, b) => b.statusSortKey.localeCompare(a.statusSortKey))[0];
        return match === undefined ? null : structuredClone(match);
      }),
  };
}
