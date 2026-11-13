import { app } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateStatus } from "@shared/ipc-schema";
import { fetchWithResilience } from "./http.service";
import { getSettings } from "./settings.service";
import { evaluateLatestRelease, LATEST_RELEASE_API } from "./update-release";

/**
 * App updates from the GitHub releases of this repository.
 *
 * Every platform asks GitHub's API for the latest release (version and tag
 * only; no user data is sent). The Windows installer build can then download
 * the update with electron-updater, which checks the file's SHA-512 against
 * the release's `latest.yml`, and install it on restart. macOS builds are not
 * signed, and Squirrel.Mac only installs signed updates, so there (and on
 * Linux) the update is offered as a link to the release page.
 *
 * Development builds never check. The check can be switched off in the
 * settings (`autoUpdateCheck: false`); a manual check stays possible.
 */

const FIRST_CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

type Listener = (status: UpdateStatus) => void;

let listener: Listener = () => {};
let status: UpdateStatus | null = null;
let updaterConfigured = false;

function canAutoInstall(): boolean {
  return app.isPackaged && process.platform === "win32";
}

function baseStatus(): UpdateStatus {
  return {
    state: app.isPackaged ? "idle" : "unsupported",
    currentVersion: app.getVersion(),
    canAutoInstall: canAutoInstall(),
  };
}

function setStatus(next: UpdateStatus): UpdateStatus {
  status = next;
  listener(next);
  return next;
}

export function getUpdateStatus(): UpdateStatus {
  return status ?? (status = baseStatus());
}

function configureUpdater(): void {
  if (updaterConfigured) return;
  updaterConfigured = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = console;
  autoUpdater.on("download-progress", (progress: { percent: number }) => {
    setStatus({
      ...getUpdateStatus(),
      state: "downloading",
      progress: Math.min(1, Math.max(0, progress.percent / 100)),
    });
  });
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  const current = getUpdateStatus();
  if (!app.isPackaged) return current;
  if (current.state === "checking" || current.state === "downloading")
    return current;
  if (current.state === "ready") return current;

  setStatus({ ...current, state: "checking", message: undefined });
  try {
    const response = await fetchWithResilience(
      LATEST_RELEASE_API,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": `DealershipRiskMapping/${app.getVersion()}`,
        },
      },
      { timeoutMs: 10_000 },
    );
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const release = evaluateLatestRelease(
      app.getVersion(),
      await response.json(),
    );
    const checkedAt = new Date().toISOString();
    if (!release?.available) {
      return setStatus({
        ...baseStatus(),
        state: "up-to-date",
        latestVersion: release?.latestVersion,
        checkedAt,
      });
    }
    return setStatus({
      ...baseStatus(),
      state: "available",
      latestVersion: release.latestVersion,
      releaseUrl: release.releaseUrl,
      checkedAt,
    });
  } catch (error) {
    console.warn("Update check failed:", error);
    return setStatus({
      ...baseStatus(),
      state: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Windows: downloads the offered update in the background. */
export async function downloadUpdate(): Promise<UpdateStatus> {
  const current = getUpdateStatus();
  if (!canAutoInstall() || current.state !== "available") return current;
  configureUpdater();
  setStatus({ ...current, state: "downloading", progress: 0 });
  try {
    const result = await autoUpdater.checkForUpdates();
    const offered = result?.updateInfo.version;
    // electron-updater reads latest.yml itself; it must agree with the API.
    if (!offered || offered !== current.latestVersion) {
      throw new Error(
        `Release metadata does not match (${offered ?? "none"} vs ${current.latestVersion})`,
      );
    }
    await autoUpdater.downloadUpdate();
    return setStatus({ ...current, state: "ready", progress: 1 });
  } catch (error) {
    console.warn("Update download failed:", error);
    return setStatus({
      ...current,
      state: "error",
      progress: undefined,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Windows: quits and runs the downloaded installer, then restarts the app. */
export function installUpdate(): boolean {
  if (!canAutoInstall() || getUpdateStatus().state !== "ready") return false;
  // `before-quit` (closing the database) runs after the windows are closed.
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
}

function autoCheckEnabled(): boolean {
  try {
    return getSettings().autoUpdateCheck !== false;
  } catch {
    return true;
  }
}

/** Starts the background checks and forwards status changes to `onChange`. */
export function startUpdateChecks(onChange: Listener): void {
  listener = onChange;
  if (!app.isPackaged) return;
  const run = (): void => {
    if (autoCheckEnabled()) void checkForUpdates();
  };
  setTimeout(run, FIRST_CHECK_DELAY_MS);
  setInterval(run, CHECK_INTERVAL_MS).unref();
}
