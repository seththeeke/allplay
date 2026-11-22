import { guestTtl } from "../../models/player";
import type { GameSession } from "../../models/gameSession";
import type { SeatAssignment } from "../../models/seatAssignment";

export const isGuest = (playerId: string): boolean => playerId.startsWith("GUEST#");

/**
 * The session with its guest `ttl` set or cleared: a session keeps one only
 * while every seat is a guest's (data-model.md section 1, principle 10).
 */
export function withSessionTtl(session: GameSession, at: Date): GameSession {
  const copy = { ...session };
  delete copy.ttl;
  return session.seats.every((seat) => isGuest(seat.playerId))
    ? { ...copy, ttl: guestTtl(at) }
    : copy;
}

/** The seat item of one of the session's players, mirroring the session status (data-model.md section 7). */
export function seatOf(session: GameSession, playerId: string, at: Date): SeatAssignment {
  const seatId = session.seats.find((seat) => seat.playerId === playerId)?.seatId ?? "S1";
  return {
    playerId,
    sessionId: session.sessionId,
    gameId: session.gameId,
    seatId,
    status: session.status,
    playerGameKey: `${playerId}|${session.gameId}`,
    statusSortKey: `${session.status}#${session.sessionId}`,
    ...(isGuest(playerId) ? { ttl: guestTtl(at) } : {}),
    entityVersion: 1,
    createdAt: session.createdAt,
    updatedAt: at.toISOString(),
  };
}

/** Every seat item of the session. */
export const seatsOf = (session: GameSession, at: Date): SeatAssignment[] =>
  session.seats.map((seat) => seatOf(session, seat.playerId, at));

/** The session ended as `ABANDONED` at the next version. */
export function abandonedCopy(session: GameSession, at: Date): GameSession {
  const version = session.version + 1;
  const stamp = at.toISOString();
  return withSessionTtl(
    {
      ...session,
      status: "ABANDONED",
      version,
      state: { ...session.state, version },
      endedAt: stamp,
      lastActionAt: stamp,
      updatedAt: stamp,
    },
    at,
  );
}
