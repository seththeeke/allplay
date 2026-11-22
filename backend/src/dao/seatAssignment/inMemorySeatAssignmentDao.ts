import { SeatAssignmentSchema, type SeatAssignment } from "../../models/seatAssignment";
import type { SeatAssignmentDao } from "./seatAssignmentDao";

/** The map key of a seat, shared with the in-memory session DAO's transactions. */
export const seatKey = (playerId: string, sessionId: string): string => `${playerId}|${sessionId}`;

/** Parses and copies a seat into the map, as a DynamoDB write would store it. */
export function storeSeat(items: Map<string, SeatAssignment>, seat: SeatAssignment): void {
  items.set(
    seatKey(seat.playerId, seat.sessionId),
    structuredClone(SeatAssignmentSchema.parse(seat)),
  );
}

/** SeatAssignmentDao over a map; items pass the schema and reads return copies. */
export function createInMemorySeatAssignmentDao(
  items: Map<string, SeatAssignment> = new Map(),
): SeatAssignmentDao {
  const run = <T>(work: () => T): Promise<T> =>
    new Promise((resolve) => {
      resolve(work());
    });
  const newestFirst = (a: SeatAssignment, b: SeatAssignment) =>
    b.sessionId.localeCompare(a.sessionId);
  return {
    get: (playerId, sessionId) =>
      run(() => {
        const item = items.get(seatKey(playerId, sessionId));
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
    list: (playerId) =>
      run(() =>
        [...items.values()]
          .filter((item) => item.playerId === playerId)
          .sort(newestFirst)
          .map((item) => structuredClone(item)),
      ),
    put: (seat) =>
      run(() => {
        storeSeat(items, seat);
      }),
    delete: (playerId, sessionId) =>
      run(() => {
        items.delete(seatKey(playerId, sessionId));
      }),
  };
}
