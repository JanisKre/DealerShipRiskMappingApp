import { lazy, Suspense, useEffect } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import i18n from "@renderer/i18n";
import { AppShell } from "@renderer/components/layout/AppShell";
import { WorkspacePage } from "@renderer/components/workspace/WorkspacePage";
import { UpdateNotifier } from "@renderer/components/settings/UpdateNotifier";
import { Toaster } from "@renderer/components/ui/sonner";

// The workspace (map) is the start page and stays in the main chunk; the
// other pages load on first visit, which keeps the startup script small.
const DashboardPage = lazy(() =>
  import("@renderer/components/dashboard/DashboardPage").then((m) => ({
    default: m.DashboardPage,
  })),
);
const ParametersPage = lazy(() =>
  import("@renderer/components/parameters/ParametersPage").then((m) => ({
    default: m.ParametersPage,
  })),
);
const SettingsPage = lazy(() =>
  import("@renderer/components/settings/SettingsPage").then((m) => ({
    default: m.SettingsPage,
  })),
);

/** A page chunk is a local file: it is there within a frame or two. */
function page(element: React.JSX.Element): React.JSX.Element {
  return <Suspense fallback={null}>{element}</Suspense>;
}

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
        // Settings not loadable → keep default (de)
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
          <Route path="dashboard" element={page(<DashboardPage />)} />
          <Route path="parameters" element={page(<ParametersPage />)} />
          <Route path="settings" element={page(<SettingsPage />)} />
        </Route>
      </Routes>
      <UpdateNotifier />
      {/* Top centre, below the header: at the bottom right the toasts
          covered the chat composer, at the top right the toolbar buttons
          (Export stayed blocked while the pointer rested on a toast). */}
      <Toaster
        position="top-center"
        offset={{ top: 64 }}
        richColors
        closeButton
      />
    </HashRouter>
  );
}
