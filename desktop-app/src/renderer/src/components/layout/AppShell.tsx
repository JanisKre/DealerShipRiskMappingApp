import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { List, MessageSquare, Radar, Search, WifiOff } from "lucide-react";
import { useAppStore } from "@renderer/store/appStore";
import { WIDE_WINDOW_PX, useMapStore } from "@renderer/store/mapStore";
import { CommandPalette } from "@renderer/components/command/CommandPalette";
import { ModelInstallWizard } from "@renderer/components/model/ModelInstallWizard";
import {
  ALL_NAV_ITEMS,
  NAV_ITEMS,
  SETTINGS_ITEM,
} from "@renderer/components/layout/navigation";
import { PortfolioSwitcher } from "@renderer/components/layout/PortfolioSwitcher";
import { ThemeToggle } from "@renderer/components/theme/ThemeToggle";
import { HintButton } from "@renderer/components/ui/hint-button";
import { Separator } from "@renderer/components/ui/separator";
import { cn } from "@renderer/lib/utils";
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

/** Whether the shortcuts use ⌘ (macOS) rather than Ctrl. */
const IS_MAC =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

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
  const sessionId = useAppStore((s) => s.sessionId);
  // Skips a portfolio that is unchanged since it was loaded: opening one
  // must not bump its "last changed" time.
  const saveSession = useAppStore((s) => s.saveSessionIfChanged);

  useEffect(() => {
    if (analyzing) return;
    // An empty portfolio is saved only once it exists on disk: deleting its
    // last location must stick, while a fresh blank one is not stored.
    if (dealerships.length === 0 && sessionId == null) return;
    const timer = setTimeout(() => {
      saveSession().catch((err: unknown) => {
        console.error("Autosave failed:", err);
      });
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [dealerships, parameters, analyzing, sessionId, saveSession]);

  return null;
}

/** Browser connectivity, updated by the online/offline events. */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
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
          setDealerships(session.dealerships, session.boundaryEdits);
          useAppStore.setState({
            pendingAnalysis: session.pendingAnalysis ?? [],
          });
          useAppStore.getState().markSaved();
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
  const online = useOnline();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const lastSavedAt = useAppStore((s) => s.lastSavedAt);
  const locationsPanelOpen = useMapStore((s) => s.locationsPanelOpen);
  const chatPanelOpen = useMapStore((s) => s.chatPanelOpen);
  const toggleLocationsPanel = useMapStore((s) => s.toggleLocationsPanel);
  const toggleChatPanel = useMapStore((s) => s.toggleChatPanel);
  const onWorkspace = pathname === "/";
  const paletteShortcut = IS_MAC ? "⌘K" : t("shell.ctrlK");

  const activeItem = ALL_NAV_ITEMS.find((item) =>
    isItemActive(pathname, item.to, item.end),
  );
  const activeTitleKey =
    activeItem?.titleKey ?? activeItem?.labelKey ?? "nav.map";
  const activeDescKey = activeItem?.descKey;
  // Settings are app-wide, so the portfolio switcher would only distract there.
  const showPortfolioSwitcher = !isItemActive(
    pathname,
    SETTINGS_ITEM.to,
    SETTINGS_ITEM.end,
  );

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
    // Narrow windows start with the icon-only sidebar to give the map room.
    <SidebarProvider
      className="h-svh"
      defaultOpen={window.innerWidth >= WIDE_WINDOW_PX}
    >
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
              v{__APP_VERSION__}
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
          {showPortfolioSwitcher && (
            <PortfolioSwitcher descriptionKey={activeDescKey} />
          )}
          {/* Page name after the portfolio, on every page (the map included,
              so the header reads the same everywhere). */}
          {showPortfolioSwitcher && (
            <Separator
              orientation="vertical"
              className="mx-1 data-[orientation=vertical]:h-4"
            />
          )}
          <h1 className="hidden truncate text-sm leading-tight font-semibold sm:block">
            {t(activeTitleKey)}
          </h1>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {!online && (
              <span
                role="status"
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-warning/40 px-2 py-0.5 text-xs text-muted-foreground"
              >
                <WifiOff className="size-3.5 text-warning-foreground" />
                {t("shell.offline")}
              </span>
            )}
            {lastSavedAt && (
              <span
                className="hidden shrink-0 text-xs text-muted-foreground md:block"
                title={new Date(lastSavedAt).toLocaleString(i18n.language)}
              >
                {t("shell.autosaved")} ·{" "}
                {new Date(lastSavedAt).toLocaleTimeString(i18n.language, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
            <HintButton
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
              onClick={() => setPaletteOpen(true)}
              aria-label={t("shell.openCommands", {
                shortcut: paletteShortcut,
              })}
            >
              <Search className="size-3.5" />
              <kbd className="hidden rounded border bg-muted px-1 font-sans text-[11px] lg:inline">
                {paletteShortcut}
              </kbd>
            </HintButton>
            {/* The docks can also be dragged shut; these bring them back. */}
            {onWorkspace && (
              <>
                <HintButton
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn("size-7", locationsPanelOpen && "bg-accent")}
                  onClick={toggleLocationsPanel}
                  aria-pressed={locationsPanelOpen}
                  aria-label={t("shell.toggleLocationsDock")}
                >
                  <List className="size-4" />
                </HintButton>
                <HintButton
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn("size-7", chatPanelOpen && "bg-accent")}
                  onClick={toggleChatPanel}
                  aria-pressed={chatPanelOpen}
                  aria-label={t("shell.toggleChatDock")}
                >
                  <MessageSquare className="size-4" />
                </HintButton>
              </>
            )}
          </div>
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
