import { Route, Routes } from "react-router";
import { AppShell } from "../components/AppShell";
import { AccountPage } from "../pages/AccountPage";
import { AdminPage } from "../pages/AdminPage";
import { HelpPage } from "../pages/HelpPage";
import { HomePage } from "../pages/HomePage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { SettingsPage } from "../pages/SettingsPage";
import { SignInPage } from "../pages/SignInPage";
import { StatsPage } from "../pages/StatsPage";
import { RequireTier } from "./RequireTier";

/** Route table. Game routes such as /spider arrive in WA-3. */
export function AppRoutes(): React.JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="help" element={<HelpPage />} />
        <Route path="sign-in" element={<SignInPage />} />
        <Route
          path="account"
          element={
            <RequireTier tier="PLAYER">
              <AccountPage />
            </RequireTier>
          }
        />
        <Route
          path="admin"
          element={
            <RequireTier tier="ADMIN">
              <AdminPage />
            </RequireTier>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
