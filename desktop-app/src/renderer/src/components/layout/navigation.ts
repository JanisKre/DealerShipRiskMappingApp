import {
  BarChart3,
  Map,
  Settings,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  /** Route path (matches the router config in App.tsx). */
  to: string;
  /** i18n key under `nav.*`. */
  labelKey: string;
  icon: LucideIcon;
  /** Exact match — only for the index route. */
  end?: boolean;
  /** i18n key for the page-header title (defaults to `labelKey`). */
  titleKey?: string;
  /** i18n key for an optional page-header subtitle. */
  descKey?: string;
};

/** Single source of truth for primary navigation, shared by the sidebar and the command palette. */
export const NAV_ITEMS: NavItem[] = [
  {
    to: "/",
    labelKey: "nav.map",
    icon: Map,
    end: true,
    titleKey: "nav.map",
  },
  { to: "/dashboard", labelKey: "nav.dashboard", icon: BarChart3 },
  { to: "/parameters", labelKey: "nav.parameters", icon: SlidersHorizontal },
];

/**
 * Settings sits separately in the sidebar footer (bottom left), not in the
 * main navigation. It is mixed back in via {@link ALL_NAV_ITEMS} for
 * header-title lookup and the command palette.
 */
export const SETTINGS_ITEM: NavItem = {
  to: "/settings",
  labelKey: "nav.settings",
  icon: Settings,
};

/** Full nav list including settings — for title lookup & the command palette. */
export const ALL_NAV_ITEMS: NavItem[] = [...NAV_ITEMS, SETTINGS_ITEM];
