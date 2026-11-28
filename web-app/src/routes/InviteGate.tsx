import { Navigate, Outlet, useLocation } from "react-router";
import { usePlayer } from "../hooks/usePlayer";

/** Pages a signed-out visitor of an invite-only stage may still open (productionalization.md section 3). */
export const PUBLIC_PATHS: readonly string[] = [
  "/sign-in",
  "/forgot-password",
  "/privacy",
  "/health",
];

/**
 * In an invite-only stage, sends a signed-out visitor to sign in, and back
 * to the page they asked for afterwards. Open stages pass straight through.
 */
export function InviteGate(): React.JSX.Element | null {
  const { player, loaded, service } = usePlayer();
  const { pathname, search } = useLocation();
  if (!service.inviteOnly || PUBLIC_PATHS.includes(pathname)) return <Outlet />;
  if (!loaded || player === undefined) return null;
  if (player.kind === "ACCOUNT") return <Outlet />;
  return <Navigate to={`/sign-in?next=${encodeURIComponent(pathname + search)}`} replace />;
}

/** Where to go after signing in: the `next` page when it is a path on this site, else home. */
export function nextPath(next: string | null): string {
  return next !== null && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
