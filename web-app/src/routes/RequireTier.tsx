import { Navigate } from "react-router";
import type { Tier } from "../models/api";
import { tierAtLeast, usePlayer } from "../hooks/usePlayer";
import { NotFoundPage } from "../pages/NotFoundPage";

export interface RequireTierProps {
  tier: Exclude<Tier, "GUEST">;
  children: React.JSX.Element;
}

/**
 * One guard per tier (cdk-stacks.md section 11.2). Admin pages answer as not
 * found to everyone else, so nothing reveals that /admin exists; account pages
 * send guests to sign in.
 */
export function RequireTier({ tier, children }: RequireTierProps): React.JSX.Element | null {
  const { player, loaded } = usePlayer();
  if (!loaded || player === undefined) return null;
  if (tierAtLeast(player.tier, tier)) return children;
  return tier === "ADMIN" ? <NotFoundPage /> : <Navigate to="/sign-in" replace />;
}
