import { Route, Routes } from "react-router";
import { AppShell } from "../components/AppShell";
import { AccountPage } from "../pages/AccountPage";
import { AdminPage } from "../pages/AdminPage";
import { ForgotPasswordPage } from "../pages/ForgotPasswordPage";
import { HealthPage } from "../pages/HealthPage";
import { HelpPage } from "../pages/HelpPage";
import { HomePage } from "../pages/HomePage";
import { PrivacyPage } from "../pages/PrivacyPage";
import { SettingsPage } from "../pages/SettingsPage";
import { SignInPage } from "../pages/SignInPage";
import { SignUpPage } from "../pages/SignUpPage";
import { StatsPage } from "../pages/StatsPage";
import { VoiceLabPage } from "../pages/VoiceLabPage";
import { GameRoute } from "./GameRoute";
import { RequireTier } from "./RequireTier";

/** Route table. Unmatched paths resolve as game links (for example /spider) or not found. */
export function AppRoutes(): React.JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="help" element={<HelpPage />} />
        <Route path="health" element={<HealthPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        <Route path="voice-lab" element={<VoiceLabPage />} />
        <Route path="sign-in" element={<SignInPage />} />
        <Route path="sign-up" element={<SignUpPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
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
        <Route path="*" element={<GameRoute />} />
      </Route>
    </Routes>
  );
}
