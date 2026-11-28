import { NavLink, Outlet } from "react-router";
import { usePaused } from "../hooks/usePaused";
import { tierAtLeast, usePlayer } from "../hooks/usePlayer";
import { PausedBanner } from "./PausedBanner";
import { VoiceProvider } from "../voice/VoiceProvider";
import { IoSettingsSharp } from "react-icons/io5";

const LINK = "rounded-lg px-3 py-1 text-lg font-semibold underline-offset-4 hover:underline";
const ACTIVE = "bg-accent text-on-accent";

function navClass({ isActive }: { isActive: boolean }): string {
  return `${LINK} ${isActive ? ACTIVE : "text-ink"}`;
}

/** "Hello, pat" from pat@example.com; just "Hello" when the account has no email. */
export function greeting(email: string | null): string {
  const name = email?.split("@")[0] ?? "";
  return name === "" ? "Hello" : `Hello, ${name}`;
}

/** Page frame: skip link, primary navigation and the routed page. */
export function AppShell(): React.JSX.Element {
  const { player } = usePlayer();
  const isAdmin = player !== undefined && tierAtLeast(player.tier, "ADMIN");
  const signedIn = player?.kind === "ACCOUNT";
  const paused = usePaused();
  return (
    <div className="min-h-screen bg-page text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:bg-surface focus:p-3"
      >
        Skip to content
      </a>
      <header className="border-b-4 border-line bg-surface">
        <nav
          aria-label="Main"
          className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-3 py-1"
        >
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
          {signedIn ? (
            <>
              <span className="px-2 text-lg font-semibold">{greeting(player.email)}</span>
              <NavLink
                to="/account"
                aria-label="Account"
                title="Account"
                className={({ isActive }) =>
                  `${navClass({ isActive })} inline-flex min-h-10 min-w-10 items-center justify-center`
                }
              >
                <IoSettingsSharp aria-hidden="true" className="size-6" />
              </NavLink>
            </>
          ) : (
            <NavLink to="/sign-in" className={navClass}>
              Sign in
            </NavLink>
          )}
        </nav>
      </header>
      {paused ? <PausedBanner /> : null}
      <VoiceProvider>
        <div id="main" className="mx-auto max-w-6xl p-4">
          <Outlet />
        </div>
      </VoiceProvider>
    </div>
  );
}
