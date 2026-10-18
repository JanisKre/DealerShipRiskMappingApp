import type { DocSlug } from "@/lib/docs-pages";
import type { Localized } from "@/lib/i18n";

export const REPO_URL = "https://github.com/JanisKre/DealerShipRiskMappingApp";
export const RELEASES_URL = `${REPO_URL}/releases`;
const DOWNLOAD_BASE = `${RELEASES_URL}/latest/download`;

/** A page of the site: the homepage, the docs overview or a docs page. */
export type Page = "home" | "docs" | DocSlug;

function depth(page: Page): number {
  return page === "home" ? 0 : page === "docs" ? 1 : 2;
}

function pathOf(page: Page): string {
  return page === "home" ? "" : page === "docs" ? "docs/" : `docs/${page}/`;
}

/**
 * Relative link from one page to another (optionally to an anchor), so the
 * site works under the GitHub Pages project path and on a custom domain.
 */
export function sitePath(from: Page, to: Page, hash = ""): string {
  return `${"../".repeat(depth(from)) || "./"}${pathOf(to)}${hash}`;
}

/** Links a file or folder on the default branch. */
export function repoFile(path: string): string {
  return `${REPO_URL}/blob/main/${path}`;
}

export type Platform = "mac-arm64" | "mac-x64" | "win-x64";

export interface DownloadOption {
  platform: Platform;
  os: "macOS" | "Windows";
  label: string;
  detail: Localized;
  file: string;
  href: string;
}

// File names come from electron-builder's artifactName
// (desktop-app/electron-builder.json) and match the README badges.
export const DOWNLOADS: DownloadOption[] = [
  {
    platform: "mac-arm64",
    os: "macOS",
    label: "Apple Silicon",
    detail: {
      en: "M1 and newer · .dmg",
      de: "M1 und neuer · .dmg",
      fr: "M1 et plus récents · .dmg",
    },
    file: "dealership-risk-desktop-mac-arm64.dmg",
    href: `${DOWNLOAD_BASE}/dealership-risk-desktop-mac-arm64.dmg`,
  },
  {
    platform: "mac-x64",
    os: "macOS",
    label: "Intel",
    detail: {
      en: "Intel Macs · .dmg",
      de: "Intel-Macs · .dmg",
      fr: "Mac Intel · .dmg",
    },
    file: "dealership-risk-desktop-mac-x64.dmg",
    href: `${DOWNLOAD_BASE}/dealership-risk-desktop-mac-x64.dmg`,
  },
  {
    platform: "win-x64",
    os: "Windows",
    label: "Windows x64",
    detail: {
      en: "Windows 10/11 · .exe installer",
      de: "Windows 10/11 · .exe-Installer",
      fr: "Windows 10/11 · installateur .exe",
    },
    file: "dealership-risk-desktop-win-x64.exe",
    href: `${DOWNLOAD_BASE}/dealership-risk-desktop-win-x64.exe`,
  },
];

export const MAC_QUARANTINE_COMMAND =
  'xattr -cr "/Applications/Dealership Risk Mapping.app"';

/**
 * Best guess from the user agent. Browsers hide the Mac CPU type, so every
 * Mac maps to Apple Silicon; the Intel build stays one click away.
 */
export function detectPlatform(userAgent: string): Platform | null {
  if (/Windows/i.test(userAgent)) return "win-x64";
  if (/Macintosh|Mac OS X/i.test(userAgent) && !/iPhone|iPad/i.test(userAgent))
    return "mac-arm64";
  return null;
}
