import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Radar } from "lucide-react";
import { useAppStore } from "@renderer/store/appStore";
import { CommandPalette } from "@renderer/components/command/CommandPalette";
import { ModelInstallWizard } from "@renderer/components/model/ModelInstallWizard";
import {
  ALL_NAV_ITEMS,
  NAV_ITEMS,
  SETTINGS_ITEM,
} from "@renderer/components/layout/navigation";
import { PortfolioSwitcher } from "@renderer/components/layout/PortfolioSwitcher";
import { ThemeToggle } from "@renderer/components/theme/ThemeToggle";
import { Separator } from "@renderer/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@renderer/components/ui/sidebar";

/** Checks whether a nav entry is active for the current path. */
function isItemActive(pathname: string, to: string, end?: boolean): boolean {
  return end ? pathname === to : pathname.startsWith(to);
}

/** Idle time after the last portfolio change before autosaving. */
const AUTOSAVE_DEBOUNCE_MS = 8_000;

/**
 * Automatically saves the portfolio once `dealerships` changes and stays
 * idle for `AUTOSAVE_DEBOUNCE_MS`. Runs app-wide (mounted in `AppShell`),
 * regardless of whether the dashboard route with the manual "Save" button
 * is ever visited — otherwise a crash/restart without an explicit save
 * would lose the entire portfolio.
 */
function AutosaveController(): null {
  const dealerships = useAppStore((s) => s.dealerships);
  const parameters = useAppStore((s) => s.parameters);
  const analyzing = useAppStore((s) => s.analyzing);
  const saveSession = useAppStore((s) => s.saveSession);

  useEffect(() => {
    if (dealerships.length === 0 || analyzing) return;
    const timer = setTimeout(() => {
      saveSession().catch((err: unknown) => {
        console.error("Autosave failed:", err);
      });
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [dealerships, parameters, analyzing, saveSession]);

  return null;
}

/** Restores the most recently saved portfolio when the app starts. */
function SessionLoader(): null {
  const setSession = useAppStore((s) => s.setSession);
  const setDealerships = useAppStore((s) => s.setDealerships);
  const setParameters = useAppStore((s) => s.setParameters);

  useEffect(() => {
    let cancelled = false;
    void window.api
      .listSessions()
      .then(async (sessions) => {
        const latest = sessions[0];
        if (!latest) return;
        const session = await window.api.loadSession(latest.id);
        if (!cancelled && session) {
          setSession(session.id, session.name);
          setParameters(session.parameters);
          setDealerships(session.dealerships);
        }
      })
      .catch((err: unknown) => {
        console.error("Loading the last saved portfolio failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [setDealerships, setParameters, setSession]);

  return null;
}

export function AppShell(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const lastSavedAt = useAppStore((s) => s.lastSavedAt);

  const activeItem = ALL_NAV_ITEMS.find((item) =>
    isItemActive(pathname, item.to, item.end),
  );
  const activeTitleKey =
    activeItem?.titleKey ?? activeItem?.labelKey ?? "nav.map";
  const activeDescKey = activeItem?.descKey;

  // Global Cmd/Ctrl+K shortcut opens the command palette.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <SidebarProvider className="h-svh">
      <SessionLoader />
      <AutosaveController />
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-1 py-1.5">
            <div className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
              <Radar className="size-4" />
            </div>
            <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm font-semibold">
                Dealership Risk
              </span>
              <span className="text-muted-foreground truncate text-xs">
                Mapping
              </span>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map(({ to, labelKey, icon: Icon, end }) => (
                  <SidebarMenuItem key={to}>
                    <SidebarMenuButton
                      asChild
                      isActive={isItemActive(pathname, to, end)}
                      tooltip={t(labelKey)}
                    >
                      <NavLink to={to} end={end}>
                        <Icon />
                        <span>{t(labelKey)}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
            <SidebarMenuButton
              asChild
              isActive={isItemActive(
                pathname,
                SETTINGS_ITEM.to,
                SETTINGS_ITEM.end,
              )}
              tooltip={t(SETTINGS_ITEM.labelKey)}
              className="flex-1"
            >
              <NavLink to={SETTINGS_ITEM.to} end={SETTINGS_ITEM.end}>
                <SETTINGS_ITEM.icon />
                <span>{t(SETTINGS_ITEM.labelKey)}</span>
              </NavLink>
            </SidebarMenuButton>
            <span className="text-muted-foreground shrink-0 px-1 text-xs group-data-[collapsible=icon]:hidden">
              v1
            </span>
            <ThemeToggle />
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="h-svh overflow-hidden">
        <header className="flex min-h-14 shrink-0 items-center gap-2 border-b px-4 py-2">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-1 data-[orientation=vertical]:h-4"
          />
          <PortfolioSwitcher descriptionKey={activeDescKey} />
          {/* Page name as a secondary separator, when on a workspace route */}
          {pathname !== "/" && (
            <>
              <Separator
                orientation="vertical"
                className="mx-1 data-[orientation=vertical]:h-4"
              />
              <h1 className="hidden truncate text-sm leading-tight font-semibold sm:block">
                {t(activeTitleKey)}
              </h1>
            </>
          )}
          {lastSavedAt && (
            <span
              className="ml-auto hidden shrink-0 text-xs text-muted-foreground md:block"
              title={new Date(lastSavedAt).toLocaleString(i18n.language)}
            >
              {t("shell.autosaved")} ·{" "}
              {new Date(lastSavedAt).toLocaleTimeString(i18n.language, {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </SidebarInset>
      <ModelInstallWizard />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </SidebarProvider>
  );
}
