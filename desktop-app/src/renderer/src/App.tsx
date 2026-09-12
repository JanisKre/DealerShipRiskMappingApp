import { useEffect } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import i18n from "@renderer/i18n";
import { AppShell } from "@renderer/components/layout/AppShell";
import { DashboardPage } from "@renderer/components/dashboard/DashboardPage";
import { SettingsPage } from "@renderer/components/settings/SettingsPage";
import { WorkspacePage } from "@renderer/components/workspace/WorkspacePage";
import { ParametersPage } from "@renderer/components/parameters/ParametersPage";
import { Toaster } from "@renderer/components/ui/sonner";

export function App(): React.JSX.Element {
  // Apply the language from persisted settings at startup.
  useEffect(() => {
    window.api
      .getSettings()
      .then((s) => {
        if (s.language && s.language !== i18n.language)
          void i18n.changeLanguage(s.language);
      })
      .catch(() => {
        // Settings not loadable → keep default (en)
      });
  }, []);

  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          {/* Index → Workspace (Addresses | Map | Chat) */}
          <Route index element={<WorkspacePage />} />
          {/* Catch legacy navigate("/map") calls → back to the workspace */}
          <Route path="map" element={<Navigate to="/" replace />} />
          <Route path="chat" element={<Navigate to="/" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="parameters" element={<ParametersPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      <Toaster position="bottom-right" richColors />
    </HashRouter>
  );
}
