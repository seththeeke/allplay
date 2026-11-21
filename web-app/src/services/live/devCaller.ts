import type { PlayerMe } from "../../models/api";

export const DEV_CALLER_HEADER = "x-allplay-dev-caller";

/**
 * The local server's development caller for the player signed in through the
 * local sign-in mock (authn-authz.md section 11): `guest:<id>`, `player:<id>`
 * or `admin:<id>`, with the id made from the email so each mock account keeps
 * its own games.
 */
export function devCallerFor(player: PlayerMe | null): string {
  if (player === null || player.kind === "GUEST") return "guest:local-guest";
  const id = (player.email ?? player.playerId)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .slice(0, 64);
  return `${player.tier === "ADMIN" ? "admin" : "player"}:${id}`;
}
