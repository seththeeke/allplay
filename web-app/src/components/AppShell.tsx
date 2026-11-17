import { NavLink, Outlet } from "react-router";
import { tierAtLeast, usePlayer } from "../hooks/usePlayer";
import { VoiceProvider } from "../voice/VoiceProvider";
import { VoiceBar } from "./VoiceBar";

const LINK = "rounded-lg px-3 py-2 text-xl font-semibold underline-offset-4 hover:underline";
const ACTIVE = "bg-accent text-on-accent";

function navClass({ isActive }: { isActive: boolean }): string {
  return `${LINK} ${isActive ? ACTIVE : "text-ink"}`;
}

/** Page frame: skip link, primary navigation and the routed page. */
export function AppShell(): React.JSX.Element {
  const { player } = usePlayer();
  const isAdmin = player !== undefined && tierAtLeast(player.tier, "ADMIN");
  const signedIn = player?.kind === "ACCOUNT";
  return (
    <div className="min-h-screen bg-page text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:bg-surface focus:p-3"
      >
        Skip to content
      </a>
      <header className="border-b-4 border-line bg-surface">
        <nav aria-label="Main" className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 p-3">
          <NavLink to="/" end className={navClass}>
            All Play
          </NavLink>
          <NavLink to="/stats" className={navClass}>
            Stats
          </NavLink>
          <NavLink to="/settings" className={navClass} data-help-id="settings">
            Settings
          </NavLink>
          <NavLink to="/help" className={navClass}>
            Help
          </NavLink>
          {isAdmin ? (
            <NavLink to="/admin" className={navClass}>
              Admin
            </NavLink>
          ) : null}
          <span className="ml-auto" />
          <NavLink to={signedIn ? "/account" : "/sign-in"} className={navClass}>
            {signedIn ? "Account" : "Sign in"}
          </NavLink>
        </nav>
      </header>
      <VoiceProvider>
        <div id="main" className="mx-auto max-w-6xl p-4 pb-64">
          <Outlet />
        </div>
        <VoiceBar />
      </VoiceProvider>
    </div>
  );
}
