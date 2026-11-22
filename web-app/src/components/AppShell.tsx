import { NavLink, Outlet } from "react-router";
import { tierAtLeast, usePlayer } from "../hooks/usePlayer";
import { VoiceProvider } from "../voice/VoiceProvider";
import { GearIcon } from "./GearIcon";

const LINK = "rounded-lg px-3 py-2 text-xl font-semibold underline-offset-4 hover:underline";
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
          {signedIn ? (
            <>
              <span className="px-3 text-xl font-semibold">{greeting(player.email)}</span>
              <NavLink
                to="/account"
                aria-label="Account"
                title="Account"
                className={({ isActive }) =>
                  `${navClass({ isActive })} inline-flex min-h-14 min-w-14 items-center justify-center`
                }
              >
                <GearIcon />
              </NavLink>
            </>
          ) : (
            <NavLink to="/sign-in" className={navClass}>
              Sign in
            </NavLink>
          )}
        </nav>
      </header>
      <VoiceProvider>
        <div id="main" className="mx-auto max-w-6xl p-4">
          <Outlet />
        </div>
      </VoiceProvider>
    </div>
  );
}
